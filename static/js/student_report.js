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
        '高度專注': { color: 'rgba(75, 192, 192, 0.8)', behaviors: new Set(['筆記', '舉手']) },
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
document.addEventListener('DOMContentLoaded', function() {
    const reportDisplayArea = document.getElementById('reportDisplayArea');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDisplay = document.getElementById('errorMessage');
    const reportSelector = document.getElementById('reportSelector');
    const loadReportButton = document.getElementById('loadReportButton');

    if (typeof current_flask_user_id !== 'undefined') {
        current_user_id_for_beacon = current_flask_user_id;
    }

    if (!reportDisplayArea || !loadingMessage || !errorMessageDisplay || !reportSelector || !loadReportButton) {
        console.error("One or more critical page elements for report display are missing.");
        if (errorMessageDisplay) {
            errorMessageDisplay.textContent = "頁面初始化錯誤，缺少必要的顯示組件，請聯繫管理員。";
            errorMessageDisplay.style.display = 'block';
        }
        if (loadingMessage) loadingMessage.style.display = 'none';
        return;
    }

    console.log('Student behavior report JS (with tabs) loaded.');
    logStudentActivity('page_view_start', 'student_report_main_page');

    reportDisplayArea.style.display = 'none';
    loadingMessage.style.display = 'block';
    loadingMessage.textContent = '正在加載報告列表...';
    errorMessageDisplay.style.display = 'none';
    loadReportButton.disabled = true;

    fetch('/api/student/reports_list')
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(`獲取報告列表失敗: ${response.status} - ${err.error || '未知伺服器錯誤'}`);
                }).catch(() => { throw new Error(`獲取報告列表失敗: ${response.status} (無法解析錯誤響應)`); });
            }
            return response.json();
        })
        .then(reports => {
            reportSelector.innerHTML = '';
            if (reports && Array.isArray(reports) && reports.length > 0) {
                reports.forEach(report => {
                    const option = document.createElement('option');
                    option.value = report.filename;
                    option.textContent = report.display_name;
                    reportSelector.appendChild(option);
                });
                loadSpecificReport(reports[0].filename);
                loadReportButton.disabled = false;
            } else {
                const option = document.createElement('option'); option.value = ""; option.textContent = "暫無可用報告"; reportSelector.appendChild(option);
                loadingMessage.textContent = "暫無可用報告。"; reportDisplayArea.style.display = 'none';
            }
        })
        .catch(error => {
            console.error('獲取報告列表失敗:', error);
            loadingMessage.style.display = 'none';
            errorMessageDisplay.textContent = `無法加載報告列表: ${escapeHtml(error.message)}`;
            errorMessageDisplay.style.display = 'block';
            reportSelector.innerHTML = '<option value="">加載列表失敗</option>';
        });

    loadReportButton.addEventListener('click', function() {
        const selectedFilename = reportSelector.value;
        if (selectedFilename) {
            logStudentActivity('click', `button_load_report_${selectedFilename}`);
            loadSpecificReport(selectedFilename);
        } else {
            errorMessageDisplay.textContent = "請先選擇一份報告。"; errorMessageDisplay.style.display = 'block';
        }
    });

    function loadSpecificReport(filename) {
        reportDisplayArea.style.display = 'none';
        loadingMessage.style.display = 'block'; loadingMessage.textContent = `正在加載報告 "${escapeHtml(filename)}"...`;
        errorMessageDisplay.style.display = 'none';

        if (currentOpenTabId && currentTabStartTime) {
            const endTime = new Date();
            const durationMs = endTime - currentTabStartTime;
            logStudentActivity('tab_view_end', currentOpenTabId, durationMs / 1000);
            currentOpenTabId = null;
            currentTabStartTime = null;
        }

        fetch(`/api/student/report?report_file=${encodeURIComponent(filename)}`)
            .then(response => {
                if (!response.ok) {
                     return response.json().then(err => { throw new Error(`HTTP error! status: ${response.status}, message: ${err.error || `無法加載報告 ${filename}`}`);
                    }).catch(() => { throw new Error(`HTTP error! status: ${response.status}, and response was not valid JSON.`); });
                }
                return response.json();
            })
            .then(data => {
                if (data.error) { throw new Error(data.error); }
                populateStudentBehaviorReport(data, filename);
                loadingMessage.style.display = 'none';
                reportDisplayArea.style.display = 'block';
                
                const firstTabButton = document.querySelector('.tab-navigation .tab-button');
                if (firstTabButton) {
                    const defaultTabIdMatch = firstTabButton.getAttribute('onclick').match(/'([^']+)'/);
                    if (defaultTabIdMatch && defaultTabIdMatch[1]) {
                         openTab({currentTarget: firstTabButton}, defaultTabIdMatch[1]);
                    }
                }
            })
            .catch(error => {
                console.error(`加載報告 ${filename} 失敗:`, error);
                loadingMessage.style.display = 'none';
                errorMessageDisplay.textContent = `無法加載報告 "${escapeHtml(filename)}": ${escapeHtml(error.message)}`;
                errorMessageDisplay.style.display = 'block'; reportDisplayArea.style.display = 'none';
            });
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
                row.insertCell().textContent = item.count || 0;
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