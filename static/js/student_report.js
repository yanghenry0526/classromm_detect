// static/js/student_report.js

// --- 全局變量用於追踪標籤頁停留時間 ---
let currentOpenTabId = null;
let currentTabStartTime = null;
// 假設這個全局變量會在用戶登入後由後端模板或JS設置
// 為了這個文件能獨立運行，我們先給一個示例值，實際應用中應動態獲取
let current_user_id_for_beacon = null; // <--- 已修正：移除了空格
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

function prepareGanttChartData(sequenceDataArray) {
    // (這個函數與您之前提供的版本相同，用於準備甘特圖數據)
    // ... 內容省略以保持簡潔，請確保您有這個函數的正確實現 ...
    if (!sequenceDataArray || !Array.isArray(sequenceDataArray)) {
        console.warn("prepareGanttChartData: Input is not a valid array.");
        return { xLabels: [], yLabels: [], datasets: [] };
    }
    const coreStatesMap = {
        "筆記": "專注學習", "目視桌面/教材": "專注學習", "目視前方": "專注學習", "目視黑板/老師": "專注學習",
        "翻閱書本": "專注學習", "坐姿直立": "專注學習", "身體前傾": "專注學習", "舉手": "專注學習",
        "玩弄物品": "非任務/分心", "目視他處": "非任務/分心", "趴睡": "非任務/分心",
        "喝水/飲食": "非任務/分心", "整理個人物品": "非任務/分心", "低頭/伏案(非睡)": "非任務/分心",
        "低頭": "非任務/分心", 
        "目視同學": "互動",
        "無明顯特定行為": "狀態不明/其他", "被遮擋/無法判斷": "狀態不明/其他"
    };
    const orderedCoreStates = ["專注學習", "互動", "非任務/分心", "狀態不明/其他"];
    const timelineEvents = []; let globalSortIndex = 0;
    sequenceDataArray.forEach((sequence, seqIdx) => {
        let baseTimeLabel = `B${sequence.batch_index || (seqIdx + 1)}`;
        let dominantStateForPoint = "狀態不明/其他"; let sourceIsHighlight = false;
        if (sequence.analysis && sequence.analysis.per_image_highlights && Array.isArray(sequence.analysis.per_image_highlights) && sequence.analysis.per_image_highlights.length > 0) {
            sourceIsHighlight = true;
            sequence.analysis.per_image_highlights.forEach(hl => {
                if (hl.behavior_category) {
                    const timestampLabel = `${baseTimeLabel}-P${hl.image_index_in_sequence}`;
                    dominantStateForPoint = coreStatesMap[hl.behavior_category] || "狀態不明/其他";
                    timelineEvents.push({ sortKey: globalSortIndex++, timeLabel: timestampLabel, coreState: dominantStateForPoint });
                }
            });
        }
        if (!sourceIsHighlight && sequence.analysis && sequence.analysis.dominant_sustained_behaviors && Array.isArray(sequence.analysis.dominant_sustained_behaviors) && sequence.analysis.dominant_sustained_behaviors.length > 0) {
            const mainBehCat = sequence.analysis.dominant_sustained_behaviors[0].behavior_category;
            dominantStateForPoint = coreStatesMap[mainBehCat] || "狀態不明/其他";
            const numImages = sequence.image_filenames_in_batch ? sequence.image_filenames_in_batch.length : 1;
            for (let i = 0; i < numImages; i++) { timelineEvents.push({ sortKey: globalSortIndex++, timeLabel: `${baseTimeLabel}-Img${i+1}`, coreState: dominantStateForPoint });}
        } else if (!sourceIsHighlight) { timelineEvents.push({ sortKey: globalSortIndex++, timeLabel: `${baseTimeLabel}-NoData`, coreState: "狀態不明/其他" });}
    });
    if (timelineEvents.length === 0) return { xLabels: [], yLabels: orderedCoreStates, datasets: [] };
    timelineEvents.sort((a, b) => a.sortKey - b.sortKey);
    const xLabels = timelineEvents.map(event => event.timeLabel);
    const datasets = orderedCoreStates.map((coreStateName, stateIndex) => {
        const dataValues = xLabels.map(label => { const event = timelineEvents.find(e => e.timeLabel === label); return (event && event.coreState === coreStateName) ? 1 : 0; });
        const chartColors = generateChartColors(orderedCoreStates.length); const color = chartColors[stateIndex % chartColors.length];
        return { label: coreStateName, data: dataValues, backgroundColor: color, barPercentage: 1.0, categoryPercentage: 1.0, };
    });
    return { yLabels: orderedCoreStates, xLabels: xLabels, datasets: datasets.filter(ds => ds.data.some(d => d > 0)) };
}

// --- 日誌記錄函數 ---
function logStudentActivity(eventType, elementOrPageId, durationInSeconds) {
    if (!current_user_is_authenticated_in_js) { // 假設這個全局變量已正確設置
        // console.log("User not authenticated, skipping activity log.");
        return;
    }

    const payload = {
        event_type: eventType,
        element_or_page_id: elementOrPageId,
    };
    if (durationInSeconds !== undefined && durationInSeconds !== null) {
        payload.duration_seconds = Math.round(durationInSeconds);
    }

    fetch('/api/log_page_event', { // 新的後端API端點
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

// 通用按鈕點擊日誌 (可以被上面的 logStudentActivity 替代，如果 eventType 設為 'click')
function logUserClick(elementName) {
    console.log("Button/Link clicked:", elementName); // 保留一個簡單的控制台日誌
    logStudentActivity('click', elementName); // 將一般點擊也發送到新的日誌API
}


// --- 標籤頁切換函數 ---
function openTab(evt, tabIdToOpen) {
    let i, tabcontent, tablinks;

    // 1. 記錄上一個標籤頁的結束和停留時間
    if (currentOpenTabId && currentTabStartTime) {
        const endTime = new Date();
        const durationMs = endTime - currentTabStartTime;
        logStudentActivity('tab_view_end', currentOpenTabId, durationMs / 1000);
    }

    // 2. 隱藏所有標籤內容並移除按鈕的 active 狀態
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
        tabcontent[i].classList.remove("active-content");
    }
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }

    // 3. 顯示選中的標籤頁內容並設置按鈕 active 狀態
    const currentTabContentElement = document.getElementById(tabIdToOpen); // 修改變量名以避免衝突
    if (currentTabContentElement) {
        currentTabContentElement.style.display = "block";
        currentTabContentElement.classList.add("active-content");
    }
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add("active");
    } else {
        // 如果是程序化調用，找到對應的按鈕並激活
        const buttons = document.getElementsByClassName("tab-button");
        for(let btn of buttons) {
            if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${tabIdToOpen}'`)){
                btn.classList.add("active");
                break;
            }
        }
    }

    // 4. 開始記錄新標籤頁的查看
    currentOpenTabId = tabIdToOpen;
    currentTabStartTime = new Date();
    logStudentActivity('tab_view_start', currentOpenTabId);
    // logUserClick(`view_tab_${tabIdToOpen}`); // 這個可以被上面的 logStudentActivity 替代
}


// --- 主邏輯：頁面加載完成後執行 ---
document.addEventListener('DOMContentLoaded', function() {
    const reportContainer = document.getElementById('reportContainer'); // 這個ID在您的HTML中是content-section的父級
    const reportDisplayArea = document.getElementById('reportDisplayArea');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDisplay = document.getElementById('errorMessage');
    const reportSelector = document.getElementById('reportSelector');
    const loadReportButton = document.getElementById('loadReportButton');

    // 嘗試從全局獲取用戶ID，用於 sendBeacon
    // 這需要在Flask模板中設置一個JS變量，例如：
    // <script> const current_flask_user_id = {{ current_user.id | tojson }}; </script>
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
    logStudentActivity('page_view_start', 'student_report_main_page'); // 記錄報告主頁面查看開始

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
                loadSpecificReport(reports[0].filename); // 默認加載最新
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

        // 在加載新報告前，結束可能存在的上一個標籤頁的計時
        if (currentOpenTabId && currentTabStartTime) {
            const endTime = new Date();
            const durationMs = endTime - currentTabStartTime;
            logStudentActivity('tab_view_end', currentOpenTabId, durationMs / 1000);
            currentOpenTabId = null; // 重置
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
                populateStudentBehaviorReport(data);
                loadingMessage.style.display = 'none';
                reportDisplayArea.style.display = 'block';
                
                // 數據加載成功後，默認打開第一個標籤頁
                const firstTabButton = document.querySelector('.tab-navigation .tab-button');
                if (firstTabButton) {
                    const defaultTabIdMatch = firstTabButton.getAttribute('onclick').match(/'([^']+)'/);
                    if (defaultTabIdMatch && defaultTabIdMatch[1]) {
                         openTab({currentTarget: firstTabButton}, defaultTabIdMatch[1]); // 傳遞事件對象和ID
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


function populateStudentBehaviorReport(reportData) {
    console.log("Populating report with new JSON structure:", JSON.stringify(reportData, null, 2));

    // --- 清理可能存在的舊圖表實例 ---
    ['overallPieChartContainer', 'behaviorLineChartContainer'].forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container && container.chartInstance) {
            container.chartInstance.destroy();
            container.chartInstance = null;
        }
        if (container) container.innerHTML = '';
    });

    // --- 1. 填充報告元數據 ---
    const metadata = reportData.report_metadata || {};
    setTextContent('studentIdDisplay', metadata.student_id || 'N/A');
    setTextContent('actualReportTime', metadata.report_generation_time || 'N/A');
    
    const analysisSourceSection = document.getElementById('analysisSourceSectionGlobal');
    if (analysisSourceSection) {
        analysisSourceSection.style.display = 'block';
        setTextContent('imageSourceFolderGlobal', metadata.student_image_source_folder || 'N/A');
        
        const summary = reportData.overall_summary || {};
        setTextContent('totalImagesFoundGlobal', summary.total_images_found || 'N/A');
        const processedImagesText = `批次: ${summary.total_batches || 'N/A'}, 總分析圖片數: ${summary.total_images_analyzed || 'N/A'}`;
        setTextContent('totalImagesAnalyzedGlobal', processedImagesText);
    }

    // --- 2. 填充 AI 觀察與建議 ---
    const summaryNotesSection = document.getElementById('summaryNotesSection');
    const notes = reportData.overall_summary ? reportData.overall_summary.ai_summary_notes : null;
    if (notes && summaryNotesSection) {
        summaryNotesSection.style.display = 'block';
        setTextContent('summaryGreeting', notes.greeting);
        setTextContent('summaryPositiveFeedback', notes.positive_feedback);
        setTextContent('summaryObservationPoints', notes.observation_points_summary);
        setTextContent('summaryDistractions', notes.reflection_points);
        setTextContent('summarySuggestions', notes.suggestions);
        setTextContent('summaryEncouragement', notes.encouragement);
    } else if (summaryNotesSection) {
        summaryNotesSection.style.display = 'none';
    }

    // --- 3. 填充整體行為統計 (表格和圓餅圖) ---
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
            // pieChartContainer.chartInstance = new Chart(canvas, {
            //     type: 'pie',
                // data: {
                //     labels: stats.map(s => s.behavior_category),
                //     datasets: [{
                //         label: '整體行為分佈',
                //         data: stats.map(s => s.percentage),
                //         backgroundColor: generateChartColors(stats.length),
                //         borderWidth: 1
                //     }]
                // },
            //     options: { /* ... 您的圖表選項 ... */ }
            // });
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
                    responsive: true,
                    maintainAspectRatio: false, // 【關鍵】這允許圖表不按原始比例縮放，而是填滿我們用CSS設定的容器大小
                    plugins: {
                        legend: {
                            position: 'top', // 【核心修改】將圖例移到頂部，防止右側溢出
                            labels: {
                                padding: 15,     // 增加圖例項之間的間距
                                font: { size: 10 } // 可以稍微縮小字體以容納更多項目
                            }
                        },
                        tooltip: { /* ... 您的 tooltip 設定 ... */ }
                    }
                }
            });

        }
    } else if (overallStatsSection) {
        overallStatsSection.style.display = 'block';
        overallStatsSection.innerHTML = '<h3>整體行為統計</h3><p>暫無整體行為統計數據。</p>';
    }

    // --- 4. 渲染行為趨勢圖 ---
    const behaviorTimelineSection = document.getElementById('behaviorTimelineSection');
    const ganttChartContainer = document.getElementById('behaviorLineChartContainer');
    const sequenceDetails = reportData.detailed_sequence_analysis;

    if (sequenceDetails && Array.isArray(sequenceDetails) && sequenceDetails.length > 0 && behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'block';
        if (ganttChartContainer && typeof Chart !== 'undefined') {
            
            const ganttChartData = prepareGanttChartData(sequenceDetails);
            
            if (ganttChartData && ganttChartData.xLabels && ganttChartData.xLabels.length > 0) {
                
                // --- 【新增的動態高度計算邏輯】 ---
                const yLabelsCount = ganttChartData.yLabels.length;
                // 每個 Y 軸標籤大約需要 30px 的空間，再加上標題、圖例、X軸標籤的額外空間約 120px
                const dynamicHeight = Math.max(300, yLabelsCount * 30 + 120); 
                ganttChartContainer.style.height = `${dynamicHeight}px`;
                // --- 新增結束 ---

                const canvas = document.createElement('canvas');
                ganttChartContainer.appendChild(canvas);
                
                ganttChartContainer.chartInstance = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: ganttChartData.xLabels,
                        datasets: ganttChartData.datasets
                    },
                    options: {
                        indexAxis: 'y', // Y軸是核心行為狀態
                        responsive: true,
                        maintainAspectRatio: false, // 【核心修改】允許圖表自由填充容器
                        scales: {
                            x: { 
                                stacked: true,
                                title: { display: true, text: '圖片序列時間點' },
                                ticks: {
                                    autoSkip: true,
                                    maxTicksLimit: 30, // 【核心修改】限制X軸標籤數量，防止溢出
                                    maxRotation: 90,
                                    minRotation: 70,
                                    font: { size: 8 },
                                }
                            },
                            y: { 
                                stacked: true,
                                labels: ganttChartData.yLabels,
                                title: { display: true, text: '主要行為狀態' },
                                ticks: { font: {size: 10} }
                            }
                        },
                        plugins: { /* ... 您的 plugins 設定 ... */ }
                    }
                });
            } else {
                ganttChartContainer.textContent = '行為時間序列數據不足或格式不正確。';
            }
        }
    } else if (behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'none';
    }

    // --- 5. 填充詳細序列分析 ---
    const specificObsContainer = document.getElementById('specificImageObservationsContainer');
    const imageBehaviorDetailsSection = document.getElementById('imageBehaviorDetailsSection');
    if (sequenceDetails && Array.isArray(sequenceDetails) && sequenceDetails.length > 0 && imageBehaviorDetailsSection) {
        imageBehaviorDetailsSection.style.display = 'block';
        if (specificObsContainer) {
            specificObsContainer.innerHTML = '';
            sequenceDetails.forEach(sequence => {
                const div = document.createElement('div');
                div.className = 'observation-block sequence-block';
                
                let analysisHTML = `<h4>批次 ${sequence.batch_index} (包含圖片: ${escapeHtml(sequence.image_filenames_in_batch.join(', '))})</h4>`;
                
                const analysis = sequence.analysis;
                if (analysis && !analysis.error) {
                    analysisHTML += `<p><small>序列分析總體信心: ${(parseFloat(analysis.sequence_analysis_confidence || 0) * 100).toFixed(0)}%</small></p>`;
                    analysisHTML += `<p><strong>序列總結:</strong> ${escapeHtml(analysis.sequence_summary || 'N/A')}</p>`;
                    
                    if (analysis.dominant_sustained_behaviors && analysis.dominant_sustained_behaviors.length > 0) {
                        analysisHTML += '<p><strong>主要持續行為:</strong><ul>';
                        analysis.dominant_sustained_behaviors.forEach(beh => {
                            analysisHTML += `<li>${escapeHtml(beh.behavior_category)} (估計佔比: ${(parseFloat(beh.estimated_duration_ratio || 0) * 100).toFixed(0)}%)</li>`;
                        });
                        analysisHTML += '</ul></p>';
                    }

                    if (analysis.per_image_highlights && analysis.per_image_highlights.length > 0) {
                        analysisHTML += '<p><strong>序列中關鍵圖片標註:</strong><ul>';
                        analysis.per_image_highlights.forEach(hl => {
                            let detailHtml = `<li>圖${hl.image_index_in_sequence}: ${escapeHtml(hl.behavior_category)} (信度: ${parseFloat(hl.confidence || 0).toFixed(2)})`;
                            if (hl.description) {
                                detailHtml += `<br><small><em>描述: ${escapeHtml(hl.description)}</em></small>`;
                            }
                            if (hl.head_pose_analysis) {
                                detailHtml += `<br><small><em>頭部姿態: ${escapeHtml(hl.head_pose_analysis.angle_description)} (估計角度: ${hl.head_pose_analysis.estimated_head_angle_degrees}°)</em></small>`;
                            }
                            detailHtml += '</li>';
                            analysisHTML += detailHtml;
                        });
                        analysisHTML += '</ul></p>';
                    }
                } else {
                    analysisHTML += `<p style="color:red;">此序列分析錯誤: ${escapeHtml(analysis ? analysis.error : '未知錯誤')}</p>`;
                }
                
                div.innerHTML = analysisHTML;
                specificObsContainer.appendChild(div);
            });
        }
    } else if (imageBehaviorDetailsSection) {
        imageBehaviorDetailsSection.style.display = 'none';
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
            user_id: current_user_id_for_beacon // 確保這個ID能被後端識別
        };
        
        // 嘗試使用 navigator.sendBeacon
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json; charset=UTF-8' });
            const beaconSent = navigator.sendBeacon('/api/log_page_event_beacon', blob);
            if(beaconSent) console.log("Beacon sent for tab_view_end_unload");
            else console.warn("Beacon for tab_view_end_unload failed to send immediately (browser queue).");
        } else {
            // Fallback (可能不會成功執行完畢)
            logStudentActivity('tab_view_end_unload_fallback', currentOpenTabId, durationSec);
        }
    }
});