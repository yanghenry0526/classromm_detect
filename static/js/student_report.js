// static/js/student_report.js

// --- 全局變量用於追踪標籤頁停留時間 ---
let currentOpenTabId = null;
let currentTabStartTime = null;
let current_user_id_for_beacon = null; 
const current_user_is_authenticated_in_js = true; // 假設用戶已登入

// --- 輔助函數 ---
function setTextContent(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text !== null && typeof text !== 'undefined' ? String(text) : 'N/A';
    }
}

function generateChartColors(count) {
    const colors = [];
    const baseColors = [
        'rgba(255, 99, 132, 0.8)', 'rgba(54, 162, 235, 0.8)', 'rgba(255, 206, 86, 0.8)',
        'rgba(75, 192, 192, 0.8)', 'rgba(153, 102, 255, 0.8)', 'rgba(255, 159, 64, 0.8)'
    ];
    for (let i = 0; i < count; i++) { colors.push(baseColors[i % baseColors.length]); }
    return colors;
}

// 【已修正】修正了 HTML 特殊字符轉義，防止 XSS 攻擊
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return unsafe === null || typeof unsafe === 'undefined' ? '' : String(unsafe);
    }
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
        //  .replace(/"/g, """)
         .replace(/'/g, "'");
}

// 【新增】輔助函數 - 解析檔名為秒數，用於甘特圖
function parseTimeToSeconds(filename) {
    if (typeof filename !== 'string') return null;
    const parts = filename.replace('.jpg', '').split('-');
    if (parts.length < 3) return null;

    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseInt(parts[2], 10) || 0;
    const milliseconds = parts.length > 3 ? parseInt(parts[3], 10) || 0 : 0;

    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}


// 【已替換】全新的 prepareGanttChartData 函數，用於生成甘特圖數據
function prepareGanttChartData(sequenceDataArray) {
    if (!sequenceDataArray || !Array.isArray(sequenceDataArray)) {
        console.warn("prepareGanttChartData: Input is not a valid array.");
        return { yLabels: [], datasets: [] };
    }

    const coreStates = {
        '高度專注': { color: 'rgba(75, 192, 192, 0.8)', behaviors: new Set(['做筆記', '舉手']) },
        '接收資訊': { color: 'rgba(54, 162, 235, 0.8)', behaviors: new Set(['目視教師', '目視黑板', '目視書本', '翻閱書本', '身體前傾', '坐姿直立']) },
        '潛在分心': { color: 'rgba(255, 159, 64, 0.8)', behaviors: new Set(['玩弄物品', '目視同學', '目視他處', '整理個人物品', '喝水/飲食', '身體後靠']) },
        '狀態不明/休息': { color: 'rgba(150, 150, 150, 0.7)', behaviors: new Set(['低頭', '趴睡', '無明顯特定行為', '被遮擋/無法判斷']) }
    };

    const orderedYLabels = ['高度專注', '接收資訊', '潛在分心', '狀態不明/休息'];
    const behaviorToStateMap = {};
    orderedYLabels.forEach(state => {
        coreStates[state].behaviors.forEach(behavior => {
            behaviorToStateMap[behavior] = state;
        });
    });

    // 1. 收集所有事件並轉換為帶有時間戳的格式
    const allEvents = [];
    sequenceDataArray.forEach(sequence => {
        if (sequence.analysis && Array.isArray(sequence.analysis.per_image_highlights)) {
            sequence.analysis.per_image_highlights.forEach(hl => {
                const imageIndex = hl.image_index_in_sequence;
                const behaviorCat = hl.behavior_category;
                
                // 兼容從 0 或 1 開始的索引
                let filename;
                if (typeof imageIndex === 'number' && imageIndex >= 0 && imageIndex < sequence.image_filenames_in_batch.length) {
                    filename = sequence.image_filenames_in_batch[imageIndex];
                } else if (typeof imageIndex === 'number' && imageIndex > 0 && imageIndex <= sequence.image_filenames_in_batch.length) {
                    filename = sequence.image_filenames_in_batch[imageIndex - 1]; // 兼容從1開始的索引
                }

                if (behaviorCat && filename) {
                    const timestamp = parseTimeToSeconds(filename);
                    if (timestamp !== null) {
                        const coreState = behaviorToStateMap[behaviorCat] || '狀態不明/休息';
                        allEvents.push({ timestamp, coreState, originalBehavior: behaviorCat });
                    }
                }
            });
        }
    });

    if (allEvents.length === 0) return { yLabels: [], datasets: [] };

    // 2. 按時間排序所有事件
    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    // 3. 創建時間段 (Gantt Segments)
    const ganttSegments = [];
    if (allEvents.length > 0) {
        let currentSegment = {
            state: allEvents[0].coreState,
            start: allEvents[0].timestamp,
            end: 0,
            behaviors: [allEvents[0].originalBehavior]
        };

        for (let i = 1; i < allEvents.length; i++) {
            if (allEvents[i].coreState !== currentSegment.state) {
                currentSegment.end = allEvents[i].timestamp;
                ganttSegments.push(currentSegment);
                currentSegment = {
                    state: allEvents[i].coreState,
                    start: allEvents[i].timestamp,
                    end: 0,
                    behaviors: [allEvents[i].originalBehavior]
                };
            } else {
                currentSegment.behaviors.push(allEvents[i].originalBehavior);
            }
        }
        currentSegment.end = allEvents[allEvents.length - 1].timestamp + 5; // 給最後一個事件增加5秒持續時間
        ganttSegments.push(currentSegment);
    }
    
    // 4. 準備 Chart.js 需要的數據格式
    const chartData = ganttSegments.map(segment => ({
        x: [segment.start, segment.end], // [startTime, endTime]
        y: segment.state,
        backgroundColor: coreStates[segment.state].color,
        behaviors: [...new Set(segment.behaviors)] // 附加行為數據給 tooltip 使用
    }));

    const datasets = [{
        label: '學習狀態持續時間',
        data: chartData,
        barPercentage: 0.8,
        categoryPercentage: 1.0,
    }];
    
    return { yLabels: orderedYLabels, datasets: datasets };
}


// --- 日誌記錄函數 ---
function logStudentActivity(eventType, elementOrPageId, durationInSeconds) {
    if (!current_user_is_authenticated_in_js) {
        return;
    }

    const payload = {
        event_type: eventType,
        element_or_page_id: elementOrPageId,
    };
    if (durationInSeconds !== undefined && durationInSeconds !== null) {
        payload.duration_seconds = Math.round(durationInSeconds);
    }

    fetch('/api/log_page_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log(`Activity logged: ${eventType} - ${elementOrPageId}`, payload);
        } else {
            console.error('Failed to log activity:', data.message);
        }
    })
    .catch(error => console.error('Error logging activity:', error));
}

function logUserClick(elementName) {
    console.log("Button/Link clicked:", elementName);
    logStudentActivity('click', elementName);
}


// --- 標籤頁切換函數 ---
function openTab(evt, tabIdToOpen) {
    let i, tabcontent, tablinks;

    if (currentOpenTabId && currentTabStartTime) {
        const endTime = new Date();
        const durationMs = endTime - currentTabStartTime;
        logStudentActivity('tab_view_end', currentOpenTabId, durationMs / 1000);
    }

    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
        tabcontent[i].classList.remove("active-content");
    }
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }

    const currentTabContentElement = document.getElementById(tabIdToOpen);
    if (currentTabContentElement) {
        currentTabContentElement.style.display = "block";
        currentTabContentElement.classList.add("active-content");
    }
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add("active");
    } else {
        const buttons = document.getElementsByClassName("tab-button");
        for(let btn of buttons) {
            if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${tabIdToOpen}'`)){
                btn.classList.add("active");
                break;
            }
        }
    }

    currentOpenTabId = tabIdToOpen;
    currentTabStartTime = new Date();
    logStudentActivity('tab_view_start', currentOpenTabId);
}

// --- 主邏輯：頁面加載完成後執行 ---
document.addEventListener('DOMContentLoaded', async function() {
    // 獲取所有必要的頁面元素
    const reportDisplayArea = document.getElementById('reportDisplayArea');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDisplay = document.getElementById('errorMessage');
    const reportSelector = document.getElementById('reportSelector');
    const loadReportButton = document.getElementById('loadReportButton');
    
    // 初始化頁面元素檢查
    if (!reportDisplayArea || !loadingMessage || !errorMessageDisplay || !reportSelector || !loadReportButton) {
        console.error("頁面初始化錯誤：缺少關鍵的報告顯示組件。");
        if(errorMessageDisplay) { // 確保元素存在
            errorMessageDisplay.textContent = "頁面初始化錯誤，請聯繫管理員。";
            errorMessageDisplay.style.display = 'block';
        }
        return;
    }
    
    logStudentActivity('page_view_start', 'student_report_main_page');
    setupImageModal();
    // 初始狀態設置
    reportDisplayArea.style.display = 'none';
    loadingMessage.textContent = '正在加載報告列表...';
    loadingMessage.style.display = 'block';
    errorMessageDisplay.style.display = 'none';
    loadReportButton.disabled = true;

    // 使用 try...catch 處理整個初始化流程的錯誤
    try {
        // 步驟 1: 異步獲取報告列表
        const response = await fetch('/api/student/reports_list');
        if (!response.ok) throw new Error(`獲取報告列表失敗 (HTTP ${response.status})`);
        const reports = await response.json();
        if (reports.error) throw new Error(reports.error);

        // 填充下拉選單
        reportSelector.innerHTML = '';
        if (reports && reports.length > 0) {
            reports.forEach(report => {
                const option = document.createElement('option');
                option.value = report.filename;
                option.textContent = report.display_name;
                reportSelector.appendChild(option);
            });
            loadReportButton.disabled = false;
            
            // 步驟 2: 異步加載並顯示最新的報告
            await loadAndDisplayReport(reports[0].filename);

        } else {
            loadingMessage.textContent = "暫無可用報告。";
        }
        
    } catch (error) {
        console.error('頁面初始化過程中發生錯誤:', error);
        loadingMessage.style.display = 'none';
        errorMessageDisplay.textContent = `無法初始化頁面: ${escapeHtml(error.message)}`;
        errorMessageDisplay.style.display = 'block';
        reportSelector.innerHTML = '<option value="">加載列表失敗</option>';
    }

    // 為“查看報告”按鈕添加事件監聽
    loadReportButton.addEventListener('click', function() {
        const selectedFilename = reportSelector.value;
        if (selectedFilename) {
            logStudentActivity('click', `button_load_report_${selectedFilename}`);
            loadAndDisplayReport(selectedFilename);
        }
    });

    // 將原有的 loadSpecificReport 函數的邏輯移到一個新的總控函數中
    async function loadAndDisplayReport(filename) {
        reportDisplayArea.style.display = 'none';
        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在加載報告 "${escapeHtml(filename)}"...`;
        errorMessageDisplay.style.display = 'none';

        // 重置標籤頁計時器
        if (currentOpenTabId && currentTabStartTime) {
            logStudentActivity('tab_view_end', currentOpenTabId, (new Date() - currentTabStartTime) / 1000);
            currentOpenTabId = null;
            currentTabStartTime = null;
        }

        try {
            // 步驟 A: 獲取行為報告數據
            const behaviorResponse = await fetch(`/api/student/report?report_file=${encodeURIComponent(filename)}`);
            if (!behaviorResponse.ok) throw new Error(`獲取行為報告失敗 (HTTP ${behaviorResponse.status})`);
            const behaviorReportData = await behaviorResponse.json();
            if (behaviorReportData.error) throw new Error(behaviorReportData.error);
            
            // 步驟 B: 填充行為報告相關內容
            populateStudentBehaviorReport(behaviorReportData, filename);

            // 步驟 C: 根據行為報告的日期，異步獲取課堂筆記數據
            const metadata = behaviorReportData.report_metadata || {};
            const reportDateStr = getStandardDate(metadata.report_generation_time);
            
            console.log(`[診斷] 正在為行為報告解析出的日期是: ${reportDateStr}`);

            if (reportDateStr) {
                // await 確保筆記內容加載完畢
                await populateKnowledgeHub(reportDateStr);
                await populateWorkbook(reportDateStr);
            } else {
                 const hubContainer = document.getElementById('knowledgeHubContainer');
                 if (hubContainer) {
                    hubContainer.innerHTML = '<p class="text-center">無法從行為報告中確定日期，無法加載課堂筆記。</p>';
                 }
            }
            
            // 步驟 D: 所有數據都準備好後，才顯示內容
            loadingMessage.style.display = 'none';
            reportDisplayArea.style.display = 'block';
            
            // 步驟 E: 打開默認的第一個頁簽
            const firstTabButton = document.querySelector('.tab-navigation .tab-button');
            if (firstTabButton) {
                firstTabButton.click(); // 直接模擬點擊
            }

        } catch (error) {
            console.error(`加載報告 ${filename} 失敗:`, error);
            loadingMessage.style.display = 'none';
            errorMessageDisplay.textContent = `無法加載報告: ${escapeHtml(error.message)}`;
            errorMessageDisplay.style.display = 'block';
        }
    }
});

function populateStudentBehaviorReport(reportData, reportFilename) {
    console.log("Populating report with data for:", reportFilename);

    // --- 步驟 0: 清理可能存在的舊圖表實例 ---
    ['overallPieChartContainer', 'behaviorLineChartContainer'].forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            if (container.chartInstance) {
                container.chartInstance.destroy();
                container.chartInstance = null;
            }
            container.innerHTML = '';
        }
    });

    // --- 步驟 1: 填充報告元數據 ---
    const metadata = reportData.report_metadata || {};
    setTextContent('studentIdDisplay', metadata.student_id || 'N/A');
    setTextContent('actualReportTime', metadata.report_generation_time ? metadata.report_generation_time.split(" ")[0] : 'N/A');
    
    const analysisSourceSection = document.getElementById('analysisSourceSectionGlobal');
    if (analysisSourceSection) {
        analysisSourceSection.style.display = 'block';
        setTextContent('imageSourceFolderGlobal', metadata.student_image_source_folder || 'N/A');
        
        const summary = reportData.overall_summary || {};
        setTextContent('totalImagesFoundGlobal', summary.total_images_found || 'N/A');
        const processedImagesText = `批次: ${summary.total_batches || 'N/A'}, 總分析圖片數: ${summary.total_images_analyzed || 'N/A'}`;
        setTextContent('totalImagesAnalyzedGlobal', processedImagesText);
    }

    // --- 步驟 2: 填充 AI 觀察與建議 ---
    // (建議HTML中對應的標籤由 <p> 改為 <div> 以符合語意)
    const summaryNotesSection = document.getElementById('summaryNotesSection');
    const notes = reportData.overall_summary ? reportData.overall_summary.ai_summary_notes : null;
    if (notes && summaryNotesSection) {
        summaryNotesSection.style.display = 'block';
        const formatText = (text) => {
            if (Array.isArray(text)) {
                return '<ul>' + text.map(item => `<li>${escapeHtml(item)}</li>`).join('') + '</ul>';
            }
            if (typeof text === 'string') {
                return '<ul>' + text.split(/, |[\r\n]+/).map(item => item.trim() ? `<li>${escapeHtml(item.trim())}</li>` : '').join('') + '</ul>';
            }
            return escapeHtml(text);
        };
        
        document.getElementById('summaryGreeting').innerHTML = `<p>${escapeHtml(notes.greeting)}</p>`;
        document.getElementById('summaryPositiveFeedback').innerHTML = `<strong>亮點觀察：</strong><p>${escapeHtml(notes.positive_feedback)}</p>`;
        document.getElementById('summaryObservationPoints').innerHTML = `<strong>行為模式提醒：</strong><p>${escapeHtml(notes.observation_points_summary)}</p>`;
        document.getElementById('summaryDistractions').innerHTML = `<strong>反思引導提問：</strong>${formatText(notes.reflection_points)}`;
        document.getElementById('summarySuggestions').innerHTML = `<strong>可實踐的小建議：</strong>${formatText(notes.suggestions)}`;
        document.getElementById('summaryEncouragement').innerHTML = `<p>${escapeHtml(notes.encouragement)}</p>`;
    } else if (summaryNotesSection) {
        summaryNotesSection.style.display = 'none';
    }

    // --- 步驟 3: 填充整體行為統計 (表格和圓餅圖) ---
    const overallStatsSection = document.getElementById('overallBehaviorStatisticsSection');
    const stats = reportData.overall_summary ? reportData.overall_summary.behavior_statistics : null;
    if (stats && Array.isArray(stats) && stats.length > 0 && overallStatsSection) {
        overallStatsSection.style.display = 'block';

        const tableBody = document.getElementById('overallBehaviorTableBody');
        if (tableBody) {
            tableBody.innerHTML = '';
            stats.forEach(item => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = item.behavior_category || 'N/A';
                // row.insertCell().textContent = item.count || 0;
                row.insertCell().textContent = `${item.percentage || 0}%`;
                row.insertCell().textContent = typeof item.average_confidence === 'number' ? item.average_confidence.toFixed(2) : "N/A";
            });
        }

        const pieChartContainer = document.getElementById('overallPieChartContainer');
        if (pieChartContainer && typeof Chart !== 'undefined') {
            const canvas = document.createElement('canvas');
            pieChartContainer.appendChild(canvas);
            pieChartContainer.chartInstance = new Chart(canvas, {
                type: 'pie',
                data: {
                    labels: stats.map(s => s.behavior_category),
                    datasets: [{
                        label: '整體行為分佈',
                        data: stats.map(s => s.percentage),
                        backgroundColor: generateChartColors(stats.length),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { padding: 15, font: { size: 10 } } } }
                }
            });
        }
    } else if (overallStatsSection) {
        overallStatsSection.style.display = 'block';
        overallStatsSection.innerHTML = '<h3>整體行為統計</h3><p>暫無整體行為統計數據。</p>';
    }

    // --- 步驟 4: 渲染行為趨勢圖 (甘特圖) ---
    const behaviorTimelineSection = document.getElementById('behaviorTimelineSection');
    const ganttChartContainer = document.getElementById('behaviorLineChartContainer');
    const sequenceDetails = reportData.detailed_sequence_analysis;

    if (sequenceDetails && Array.isArray(sequenceDetails) && sequenceDetails.length > 0 && behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'block';
        if (ganttChartContainer && typeof Chart !== 'undefined') {
            
            const ganttChartData = prepareGanttChartData(sequenceDetails);
            
            if (ganttChartData && ganttChartData.datasets[0] && ganttChartData.datasets[0].data.length > 0) {
                
                const yLabelsCount = ganttChartData.yLabels.length;
                const dynamicHeight = Math.max(250, yLabelsCount * 50 + 100); 
                ganttChartContainer.style.height = `${dynamicHeight}px`;

                const canvas = document.createElement('canvas');
                ganttChartContainer.appendChild(canvas);
                
                // 【已修正】使用新的 Chart.js 設定來繪製帶有顏色的甘特圖
                ganttChartContainer.chartInstance = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: ganttChartData.yLabels,
                        datasets: ganttChartData.datasets
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                type: 'linear',
                                position: 'bottom',
                                min: 0,
                                title: {
                                    display: true,
                                    text: '時間 (分鐘)'
                                },
                                ticks: {
                                    stepSize: 900,
                                    callback: function(value, index, values) {
                                        return value / 60;
                                    }
                                }
                            },
                            y: {
                                type: 'category',
                                title: {
                                    display: true,
                                    text: '核心學習狀態'
                                },
                                ticks: { font: { size: 12 } }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const startSeconds = Array.isArray(context.raw.x) ? context.raw.x[0] : context.parsed.x;
                                        const endSeconds = Array.isArray(context.raw.x) ? context.raw.x[1] : context.parsed.x;
                                        const durationSeconds = endSeconds - startSeconds;
                                        
                                        const toMinSec = (s) => `${Math.floor(s / 60)}分 ${Math.round(s % 60)}秒`;

                                        let tooltipText = [
                                            `狀態: ${context.label}`,
                                            `開始: ${toMinSec(startSeconds)} | 結束: ${toMinSec(endSeconds)}`,
                                            `持續: ${toMinSec(durationSeconds)}`
                                        ];

                                        if (context.raw.behaviors && context.raw.behaviors.length > 0) {
                                            tooltipText.push('---');
                                            tooltipText.push('主要行為:');
                                            tooltipText.push(...context.raw.behaviors.slice(0, 5).map(b => `- ${b}`)); // 最多顯示5個
                                        }

                                        return tooltipText;
                                    }
                                }
                            }
                        },
                        elements: {
                            bar: {
                                backgroundColor: (context) => {
                                    if (context.raw && context.raw.backgroundColor) {
                                        return context.raw.backgroundColor;
                                    }
                                    return 'rgba(201, 203, 207, 0.8)'; 
                                }
                            }
                        }
                    }
                });
            } else {
                ganttChartContainer.innerHTML = '<p>行為時間序列數據不足或格式不正確，無法生成圖表。</p>';
            }
        }
    } else if (behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'none';
    }


    // --- 步驟 5: 填充詳細序列分析 (批次與圖片) ---
    const specificObsContainer = document.getElementById('specificImageObservationsContainer');
    const imageBehaviorDetailsSection = document.getElementById('sequenceDetailsTab');
    
    if (sequenceDetails && Array.isArray(sequenceDetails) && sequenceDetails.length > 0 && imageBehaviorDetailsSection) {
        imageBehaviorDetailsSection.style.display = 'block';
        if (specificObsContainer) {
            specificObsContainer.innerHTML = '';
            
            sequenceDetails.forEach(sequence => {
                const batchContainer = document.createElement('div');
                batchContainer.className = 'observation-block sequence-block';

                let batchHeaderHTML = `<h4>批次 ${sequence.batch_index}</h4>`;
                const analysis = sequence.analysis;
                if (analysis && !analysis.error) {
                    batchHeaderHTML += `<p><small>序列分析總體信心: ${(parseFloat(analysis.sequence_analysis_confidence || 0) * 100).toFixed(0)}%</small></p>`;
                    batchHeaderHTML += `<p><strong>序列總結:</strong> ${escapeHtml(analysis.sequence_summary || 'N/A')}</p>`;
                } else {
                    batchHeaderHTML += `<p style="color:red;">此序列分析錯誤: ${escapeHtml(analysis ? analysis.error : '未知錯誤')}</p>`;
                }
                batchContainer.innerHTML = batchHeaderHTML;

                const detailsGrid = document.createElement('div');
                detailsGrid.className = 'details-grid';

                if (analysis && analysis.per_image_highlights && analysis.per_image_highlights.length > 0) {
                    analysis.per_image_highlights.forEach(hl => {
                        let imageIndex = hl.image_index_in_sequence;
                        let filenameIndex;

                        if (typeof imageIndex === 'number' && imageIndex >= 0 && imageIndex < sequence.image_filenames_in_batch.length) {
                            filenameIndex = imageIndex; // 索引從 0 開始
                        } else if (typeof imageIndex === 'number' && imageIndex > 0 && imageIndex <= sequence.image_filenames_in_batch.length) {
                            filenameIndex = imageIndex - 1; // 兼容索引從 1 開始
                        } else {
                             console.warn("Invalid image_index_in_sequence found:", hl);
                             return;
                        }
                        
                        const detailItem = document.createElement('div');
                        detailItem.className = 'detail-item';

                        const imageFilename = sequence.image_filenames_in_batch[filenameIndex];
                        const imgSrc = `/api/get_sequence_image?report_file=${encodeURIComponent(reportFilename)}&image_file=${encodeURIComponent(imageFilename)}`;
                        const imgTag = `<img src="${imgSrc}" alt="${escapeHtml(imageFilename)}" class="sequence-image" loading="lazy">`;

                        let textHtml = `<div class="detail-text">`;
                        textHtml += `<strong>${escapeHtml(imageFilename)}</strong><br>`;
                        textHtml += `行為: ${escapeHtml(hl.behavior_category)} (信度: ${parseFloat(hl.confidence || 0).toFixed(2)})<br>`;
                        if (hl.description) { textHtml += `<small><em>描述: ${escapeHtml(hl.description)}</em></small><br>`; }
                        if (hl.head_pose_analysis) { textHtml += `<small><em>頭部姿態: ${escapeHtml(hl.head_pose_analysis.angle_description)}</em></small>`; }
                        textHtml += `</div>`;

                        detailItem.innerHTML = imgTag + textHtml;
                        detailsGrid.appendChild(detailItem);
                    });
                }
                
                batchContainer.appendChild(detailsGrid);
                specificObsContainer.appendChild(batchContainer);
            });
        }
    } else if (imageBehaviorDetailsSection) {
        imageBehaviorDetailsSection.style.display = 'block';
        if (specificObsContainer) {
            specificObsContainer.innerHTML = '<p>無詳細序列分析數據可顯示。</p>';
        }
    }


}

function getStandardDate(dateString) {
    if (!dateString) return null;
    
    // 嘗試解析 '2025-07-06 12:34:56'
    let match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];

    // 嘗試解析 '07/06'
    match = dateString.match(/^(\d{2})\/(\d{2})/);
    if (match) {
        const year = new Date().getFullYear(); // 假設是當前年份
        return `${year}-${match[1]}-${match[2]}`;
    }
    
    return null; // 如果格式未知
}

/** 
 * @param {string} reportDate - 'YYYY-MM-DD' 格式的日期字符串。
 * @returns {Promise<void>} 一個在操作完成後解析的 Promise。
 */
async function populateKnowledgeHub(reportDate) {
    const hubContainer = document.getElementById('knowledgeHubContainer');
    
    // 步驟 1: 檢查容器是否存在，這是基本防錯
    if (!hubContainer) {
        console.error("Fatal Error: The container 'knowledgeHubContainer' was not found in the DOM.");
        return;
    }

    // 步驟 2: 準備並顯示加載提示
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'text-center'; // 假設您有這個 CSS class 來居中文字
    loadingMessage.style.padding = '20px'; // 增加一些內邊距
    loadingMessage.textContent = `正在為您加載 ${reportDate} 的課堂筆記...`;
    
    hubContainer.innerHTML = ''; // 清空任何舊內容
    hubContainer.appendChild(loadingMessage);

    try {
        // 步驟 3: 發起非同步 fetch 請求
        const response = await fetch(`/api/student/get_note_report_for_date?date=${encodeURIComponent(reportDate)}`);

        // 檢查 HTTP 響應狀態
        if (!response.ok) {
            // 嘗試解析錯誤的JSON體，如果有的話
            const errorData = await response.json().catch(() => null); 
            const errorMessage = errorData?.error || `獲取筆記失敗 (HTTP ${response.status})`;
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // 檢查後端返回的業務邏輯錯誤
        if (data.error) {
            throw new Error(data.error);
        }
        
        // 步驟 4: 處理成功獲取的數據
        // 優先使用精煉後的數據
        const refinedData = data.knowledge_hub_refined?.refined_knowledge_hub;
        
        if (refinedData && Array.isArray(refinedData) && refinedData.length > 0) {
            // 【核心修改點】
            // 調用渲染函數，並將 `reportDate` 作為第三個參數傳入
            renderKnowledgeHubForStudent(refinedData, hubContainer, reportDate);
        } else {
            // 如果後端返回了特定訊息（例如“暫無筆記”），就顯示它
            // 否則顯示一個通用的提示
            const messageToShow = data.message || '暫無此日期的課堂筆記可供查看。';
            hubContainer.innerHTML = `<p class="text-center">${escapeHtml(messageToShow)}</p>`;
        }
    } catch (error) {
        // 步驟 5: 統一處理所有錯誤（網絡錯誤、解析錯誤、業務錯誤）
        console.error(`獲取日期 ${reportDate} 的筆記時發生錯誤:`, error);
        
        // 在界面上顯示對用戶友好的錯誤訊息
        hubContainer.innerHTML = `<p class="error-message" style="color: red; text-align: center;">無法加載課堂筆記: ${escapeHtml(error.message)}</p>`;
    }
}


/**
 * 【新增】專門為學生報告頁面渲染知識庫的函數
 * @param {Array} hubData - 包含所有主題的陣列
 * @param {HTMLElement} container - 要渲染內容的容器元素
 * @param {string} reportDate - 當前報告的日期 (格式 YYYY-MM-DD)，用於構建圖片URL
 */
function renderKnowledgeHubForStudent(hubData, container, reportDate) { // 【修改點 1】新增 reportDate 參數
    container.innerHTML = ''; // 清空加載提示

    if (!reportDate) {
        console.error("renderKnowledgeHubForStudent 錯誤: 未提供 reportDate，無法生成圖片路徑。");
        // 可以選擇顯示一個錯誤訊息
    }

    hubData.forEach(topic => {
        const topicItem = document.createElement('div');
        topicItem.className = 'knowledge-topic-card';

        const button = document.createElement('button');
        button.className = 'accordion-button';
        button.innerHTML = `<h3>${escapeHtml(topic.main_topic)}</h3>`;
        
        const panel = document.createElement('div');
        panel.className = 'accordion-panel';

        panel.innerHTML += `<div class="topic-section"><h4>AI 摘要</h4><p>${escapeHtml(topic.topic_summary)}</p></div>`;
        panel.innerHTML += `<div class="topic-section"><h4>完整教學筆記</h4><div class="transcript-content">${escapeHtml(topic.refined_transcript_content).replace(/\n/g, '<br>')}</div></div>`;

        if (topic.relevant_blackboard_images && topic.relevant_blackboard_images.length > 0) {
            let imagesHTML = '<div class="topic-section"><h4>相關板書快照</h4><div class="image-gallery">';
            topic.relevant_blackboard_images.forEach(imgPath => {
                const imageName = imgPath.split('\\').pop().split('/').pop();
                
                // 【修改點 2】構建新的、包含日期的圖片 URL
                const imageUrl = `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imageName)}`;
                
                imagesHTML += `
                    <div class="gallery-item">
                        <img src="${imageUrl}" alt="${escapeHtml(imageName)}" loading="lazy" class="zoomable-image">
                        <p>${escapeHtml(imageName)}</p>
                    </div>`;
            });
            imagesHTML += '</div></div>';
            panel.innerHTML += imagesHTML;
        }

        topicItem.appendChild(button);
        topicItem.appendChild(panel);
        container.appendChild(topicItem);
        
        // ... button click event listener ...
        button.addEventListener('click', function() {
            logStudentActivity('click', `student_report_toggle_note_${topic.main_topic}`);
            this.classList.toggle('active');
            const panel = this.nextElementSibling;
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            }
        });
    });
}

/**
 * 【新增】輔助函數：從多種可能的日期格式中獲取 YYYY-MM-DD
 * @param {string} dateString - 來自報告元數據的日期時間字串
 * @returns {string|null} - 返回 'YYYY-MM-DD' 格式的字串，或在失敗時返回 null
 */
function getStandardDate(dateString) {
    if (!dateString) return null;
    
    // 優先嘗試解析 '2025-07-06 12:34:56' 或 '2025-07-06'
    let match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];

    // 接著嘗試解析 '07/06'
    match = dateString.match(/^(\d{1,2})\/(\d{1,2})/);
    if (match) {
        const year = new Date().getFullYear(); // 假設是當前年份
        const month = match[1].padStart(2, '0'); // 確保月份是兩位數
        const day = match[2].padStart(2, '0');   // 確保天是兩位數
        return `${year}-${month}-${day}`;
    }
    
    console.warn("無法從以下字串解析標準日期:", dateString);
    return null; // 如果格式未知或不匹配
}


/**
 * 【修改後的版本】
 * 【新增】異步函數：根據日期獲取並渲染 AI 練習挑戰
 * @param {string} reportDate - 'YYYY-MM-DD' 格式的日期
 * @returns {Promise<void>}
 */
async function populateWorkbook(reportDate) {
    const workbookContainer = document.getElementById('workbookContainer');
    if (!workbookContainer) {
        console.error("Fatal: Workbook container 'workbookContainer' not found in HTML!");
        return;
    }

    const loadingMessage = document.createElement('p');
    loadingMessage.className = 'text-center';
    loadingMessage.style.padding = '20px';
    loadingMessage.textContent = `正在為您加載 ${reportDate} 的練習...`;
    
    workbookContainer.innerHTML = ''; 
    workbookContainer.appendChild(loadingMessage);

    try {
        const response = await fetch(`/api/student/get_workbook_report_for_date?date=${encodeURIComponent(reportDate)}`);
        if (!response.ok) {
            throw new Error(`獲取練習冊失敗 (HTTP ${response.status})`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }

        const workbookData = data.workbook_data?.refined_knowledge_hub;
        if (workbookData && Array.isArray(workbookData) && workbookData.length > 0) {
            // 【關鍵修改】呼叫 renderWorkbook 時，把 reportDate 作為第三個參數傳遞進去
            renderWorkbook(workbookData, workbookContainer, reportDate);
        } else {
            workbookContainer.innerHTML = `<p class="text-center">${escapeHtml(data.message || '暫無此日期的練習可供查看。')}</p>`;
        }
    } catch (error) {
        console.error(`獲取日期 ${reportDate} 的練習冊失敗:`, error);
        workbookContainer.innerHTML = `<p class="error-message">無法加載練習: ${escapeHtml(error.message)}</p>`;
    }
}

/**
 * 【修正版】
 * 渲染函數：將練習冊數據渲染為互動式任務卡片
 * @param {Array} workbookData - 包含所有主題和測驗的陣列
 * @param {HTMLElement} container - 要渲染內容的容器元素
 * @param {string} reportDate - 當前報告的日期 (格式 YYYY-MM-DD)，用於構建圖片URL
 */
function renderWorkbook(workbookData, container, reportDate) {
    container.innerHTML = ''; // 清空加載提示
    window.g_workbookData = workbookData;

    if (!reportDate) {
        console.error("renderWorkbook 警告: 未提供 reportDate，練習冊中的圖片可能無法加載。");
    }

    workbookData.forEach((topic, topicIndex) => {
        // --- 創建手風琴的基礎結構 ---
        const missionCard = document.createElement('div');
        missionCard.className = 'mission-card';

        const button = document.createElement('button');
        button.className = 'accordion-button';
        button.innerHTML = `<h3>練習 #${topicIndex + 1}: ${escapeHtml(topic.main_topic)}</h3>`;
        
        const panel = document.createElement('div');
        panel.className = 'accordion-panel';

        // --- Part 1: 快速複習 ---
        const reviewSection = document.createElement('div');
        reviewSection.className = 'review-section';

        let reviewHTML = `<h4>Part 1: 快速複習</h4>`;
        reviewHTML += `<div class="topic-section"><h5>AI 摘要</h5><p>${escapeHtml(topic.topic_summary)}</p></div>`;
        reviewHTML += `<div class="topic-section"><h5>完整教學筆記</h5><div class="transcript-content">${escapeHtml(topic.refined_transcript_content).replace(/\n/g, '<br>')}</div></div>`;
        
        if (topic.relevant_blackboard_images && topic.relevant_blackboard_images.length > 0) {
            reviewHTML += '<div class="topic-section"><h5>相關板書畫面</h5><div class="image-gallery">';
            topic.relevant_blackboard_images.forEach(imgPath => {
                const imageName = imgPath.split('\\').pop().split('/').pop();
                const imageUrl = reportDate ? `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imageName)}` : '';
                reviewHTML += `<div class="gallery-item"><img src="${imageUrl}" alt="${escapeHtml(imageName)}" loading="lazy" class="zoomable-image"></div>`;
            });
            reviewHTML += '</div></div>';
        }
        reviewSection.innerHTML = reviewHTML;
        
        // 【正確的追加方式 1】將複習部分添加到 panel
        panel.appendChild(reviewSection);

        // --- Part 2: 開始挑戰 (渲染表單) ---
        const challengeSection = document.createElement('div');
        challengeSection.className = 'challenge-section';
        challengeSection.innerHTML = '<h4>Part 2: 開始練習！</h4>';

        const form = document.createElement('form');
        form.id = `quiz-form-${topicIndex}`;
        form.addEventListener('submit', (e) => {
            e.preventDefault(); 
            checkAnswers(topicIndex);
            logStudentActivity('click', `submit_quiz_${topic.main_topic}`);
        });

        if (topic.interactive_quiz && Array.isArray(topic.interactive_quiz)) {
            topic.interactive_quiz.forEach((quizItem, quizIndex) => {
                const questionDiv = document.createElement('div');
                questionDiv.className = 'quiz-item';
                
                let questionHTML = `<p><strong>Q${quizIndex + 1}:</strong> ${escapeHtml(quizItem.question)}</p>`;

                if (quizItem.type === 'multiple_choice' && quizItem.options) {
                    quizItem.options.forEach(option => {
                        questionHTML += `<label class="quiz-option"><input type="radio" name="quiz-${topicIndex}-${quizIndex}" value="${escapeHtml(option)}"> ${escapeHtml(option)}</label>`;
                    });
                } else if (quizItem.type === 'fill_in_the_blank') {
                    questionHTML += `<input type="text" class="quiz-input" name="quiz-${topicIndex}-${quizIndex}" placeholder="請在此輸入答案">`;
                }
                
                questionHTML += `<div class="feedback-area" id="feedback-${topicIndex}-${quizIndex}"></div>`;
                questionDiv.innerHTML = questionHTML;
                form.appendChild(questionDiv);
            });
        }

        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.className = 'submit-quiz-button';
        submitButton.textContent = '提交答案';
        form.appendChild(submitButton);

        challengeSection.appendChild(form);
        
        // 【正確的追加方式 2】將挑戰部分添加到 panel
        panel.appendChild(challengeSection);
        
        // --- 組合最終的卡片 ---
        missionCard.appendChild(button);
        missionCard.appendChild(panel);
        container.appendChild(missionCard);
        
        // --- 添加手風琴點擊事件 ---
        button.addEventListener('click', function() {
            logStudentActivity('click', `toggle_workbook_${topic.main_topic}`);
            this.classList.toggle('active');
            const panelElement = this.nextElementSibling;
            if (panelElement.style.maxHeight) {
                panelElement.style.maxHeight = null;
            } else {
                panelElement.style.maxHeight = panelElement.scrollHeight + "px";
            }
        });
    });
}

/**
 * 【新增】核對答案並顯示即時回饋
 * @param {number} topicIndex - 正在作答的主題索引
 */
function checkAnswers(topicIndex) {
    // 從全局變數中獲取我們之前保存的數據
    const topicData = window.g_workbookData[topicIndex];
    if (!topicData) return;

    topicData.interactive_quiz.forEach((quizItem, quizIndex) => {
        const feedbackDiv = document.getElementById(`feedback-${topicIndex}-${quizIndex}`);
        const formElements = document.getElementById(`quiz-form-${topicIndex}`).elements;
        const inputGroup = formElements[`quiz-${topicIndex}-${quizIndex}`];
        
        let userAnswer = '';
        if (quizItem.type === 'multiple_choice') {
            userAnswer = inputGroup.value; // 對於 radio group，.value 直接獲取選中的值
        } else if (quizItem.type === 'fill_in_the_blank') {
            userAnswer = inputGroup.value.trim();
        }

        // 比較答案 (忽略大小寫差異)
        if (userAnswer && userAnswer.toLowerCase() === quizItem.answer.toLowerCase()) {
            feedbackDiv.innerHTML = `<p class="correct">✔️ 正確！</p>`;
        } else {
            feedbackDiv.innerHTML = `<p class="incorrect">❌ 錯誤。正確答案是: <strong>${escapeHtml(quizItem.answer)}</strong></p>`;
        }
        
        // 無論對錯，都顯示答案解析
        feedbackDiv.innerHTML += `<p class="explanation"><strong>解析：</strong>${escapeHtml(quizItem.explanation)}</p>`;
    });
}

function setupImageModal() {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const captionText = document.getElementById('modalCaption');
    const closeBtn = document.querySelector('.modal .close-button');

    if (!modal || !modalImg || !captionText || !closeBtn) {
        console.warn("Modal elements not found, image zoom functionality disabled.");
        return;
    }

    // --- 核心邏輯：使用事件委派 (Event Delegation) ---
    // 因為圖片是動態生成的，我們將點擊事件綁定到 document 上，然後檢查點擊的目標是否是我們想要的圖片。
    document.addEventListener('click', function(event) {
        // 檢查點擊的元素是否帶有 'zoomable-image' 這個 class
        if (event.target.classList.contains('zoomable-image')) {
            const clickedImage = event.target;

            // 記錄點擊事件
            logStudentActivity('click', `zoom_image_${clickedImage.alt}`);

            // 設置 Modal 內容並顯示
            modalImg.src = clickedImage.src;
            captionText.textContent = clickedImage.alt; // 使用 alt 作為標題
            modal.style.display = "block";
        }
    });

    // --- 關閉 Modal 的邏輯 ---

    // 1. 點擊關閉按鈕 (X)
    closeBtn.onclick = function() { 
        modal.style.display = "none";
    }

    // 2. 點擊 Modal 背景（遮罩層）時關閉
    modal.onclick = function(event) {
        // 確保點擊的是背景，而不是圖片本身
        if (event.target === modal) {
            modal.style.display = "none";
        }
    }
}

// 頁面卸載時記錄最後一個標籤頁的停留時間
window.addEventListener('beforeunload', function (e) {
    if (currentOpenTabId && currentTabStartTime) {
        const endTime = new Date();
        const durationMs = endTime - currentTabStartTime;
        const durationSec = Math.round(durationMs / 1000);

        const payload = {
            event_type: 'tab_view_end_unload',
            element_or_page_id: currentOpenTabId,
            duration_seconds: durationSec,
            user_id: current_user_id_for_beacon
        };
        
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json; charset=UTF-8' });
            const beaconSent = navigator.sendBeacon('/api/log_page_event_beacon', blob);
            if(beaconSent) console.log("Beacon sent for tab_view_end_unload");
            else console.warn("Beacon for tab_view_end_unload failed to send immediately (browser queue).");
        } else {
            logStudentActivity('tab_view_end_unload_fallback', currentOpenTabId, durationSec);
        }
    }
}); 