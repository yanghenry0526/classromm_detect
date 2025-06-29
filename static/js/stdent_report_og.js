// static/js/student_report.js

document.addEventListener('DOMContentLoaded', function() {
    const reportContainer = document.getElementById('reportContainer');
    const reportDisplayArea = document.getElementById('reportDisplayArea');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDisplay = document.getElementById('errorMessage');
    const reportSelector = document.getElementById('reportSelector');
    const loadReportButton = document.getElementById('loadReportButton');

    if (!reportContainer || !reportDisplayArea || !loadingMessage || !errorMessageDisplay || !reportSelector || !loadReportButton) {
        console.error("One or more critical page elements for report display are missing.");
        if (errorMessageDisplay) {
            errorMessageDisplay.textContent = "頁面初始化錯誤，缺少必要的顯示組件，請聯繫管理員。";
            errorMessageDisplay.style.display = 'block';
        }
        if (loadingMessage) loadingMessage.style.display = 'none';
        return;
    }

    console.log('Student behavior report JS loaded.');
    if (typeof logUserClick === 'function') {
        logUserClick('view_student_behavior_report_page_js');
    }

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
            if (typeof logUserClick === 'function') { logUserClick(`button_load_report_${selectedFilename}`); }
            loadSpecificReport(selectedFilename);
        } else {
            errorMessageDisplay.textContent = "請先選擇一份報告。"; errorMessageDisplay.style.display = 'block';
        }
    });

    function loadSpecificReport(filename) {
        reportDisplayArea.style.display = 'none';
        loadingMessage.style.display = 'block'; loadingMessage.textContent = `正在加載報告 "${escapeHtml(filename)}"...`;
        errorMessageDisplay.style.display = 'none';

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
                loadingMessage.style.display = 'none'; reportDisplayArea.style.display = 'block';
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
    console.log("將要填充的報告數據 (序列分析版):", reportData);

    // --- 清理可能存在的舊圖表實例 ---
    const chartContainerIds = ['overallPieChartContainer', 'behaviorLineChartContainer'];
    chartContainerIds.forEach(containerId => {
        const chartContainerElement = document.getElementById(containerId);
        if (chartContainerElement) {
            if (chartContainerElement.chartInstance) {
                try {
                    chartContainerElement.chartInstance.destroy();
                } catch (e) {
                    console.warn("Error destroying previous chart instance:", e);
                }
                chartContainerElement.chartInstance = null;
            }
            chartContainerElement.innerHTML = ''; // 清空容器
        }
    });

    // --- 1. 填充報告頭部元數據 ---
    setTextContent('studentIdDisplay', reportData.student_id);
    setTextContent('reportGenerationTime', `報告生成時間: ${reportData.report_generation_time}`);
    
    const analysisSourceSection = document.getElementById('analysisSourceSection');
    if (reportData.image_source_folder || typeof reportData.total_images_found !== 'undefined') {
        if(analysisSourceSection) analysisSourceSection.style.display = 'block';
        setTextContent('imageSourceFolder', reportData.image_source_folder);
        setTextContent('totalImagesFound', reportData.total_images_found);
        setTextContent('totalImagesAnalyzed', `批次: ${reportData.total_batches_analyzed}, 總分析圖片數 (估算): ${reportData.total_images_analyzed_successfully * (reportData.images_per_batch_setting || 1)}`);
    } else if(analysisSourceSection) {
        analysisSourceSection.style.display = 'none';
    }

    // --- 2. 填充 Summary Notes ---
    const summaryNotesSection = document.getElementById('summaryNotesSection');
    if (reportData.summary_notes) {
        if(summaryNotesSection) summaryNotesSection.style.display = 'block';
        const notes = reportData.summary_notes;
        setTextContent('summaryGreeting', notes.greeting);
        setTextContent('summaryPositiveFeedback', notes.positive_feedback);
        setTextContent('summaryObservationPoints', notes.observation_points_summary);
        setTextContent('summaryDistractions', notes.reflection_points); // 使用 reflection_points
        setTextContent('summarySuggestions', notes.suggestions);        // 使用 suggestions
        setTextContent('summaryEncouragement', notes.encouragement);
    } else if (summaryNotesSection) {
        summaryNotesSection.style.display = 'none';
    }

    // --- 3. 計算並渲染整體行為統計 (基於 per_image_highlights) ---
    const overallStatsSection = document.getElementById('overallBehaviorStatisticsSection');
    let overallBehaviorStatsForDisplay = [];

    if (reportData.sequence_analysis_details && Array.isArray(reportData.sequence_analysis_details) && reportData.sequence_analysis_details.length > 0) {
        if(overallStatsSection) overallStatsSection.style.display = 'block';

        const behaviorCounts = new Map();
        const behaviorConfidenceSums = new Map();
        let totalValidHighlightInstances = 0;

        reportData.sequence_analysis_details.forEach(sequence => {
            if (sequence.analysis && sequence.analysis.per_image_highlights && Array.isArray(sequence.analysis.per_image_highlights)) {
                sequence.analysis.per_image_highlights.forEach(highlight => {
                    if (highlight && highlight.behavior_category && typeof highlight.confidence === 'number') {
                        const category = highlight.behavior_category;
                        const confidence = parseFloat(highlight.confidence);

                        behaviorCounts.set(category, (behaviorCounts.get(category) || 0) + 1);
                        behaviorConfidenceSums.set(category, (behaviorConfidenceSums.get(category) || 0) + confidence);
                        totalValidHighlightInstances++;
                    }
                });
            }
        });

        if (totalValidHighlightInstances > 0) {
            behaviorCounts.forEach((count, category) => {
                const sumConfidence = behaviorConfidenceSums.get(category) || 0;
                overallBehaviorStatsForDisplay.push({
                    behavior_category: category,
                    count: count,
                    percentage: parseFloat(((count / totalValidHighlightInstances) * 100).toFixed(1)),
                    average_confidence: count > 0 ? parseFloat((sumConfidence / count).toFixed(2)) : 0
                });
            });
            overallBehaviorStatsForDisplay.sort((a, b) => b.count - a.count); // 按實際次數降序
        }

        // 填充表格
        const tableBody = document.getElementById('overallBehaviorTableBody');
        if (tableBody) {
            tableBody.innerHTML = '';
            if (overallBehaviorStatsForDisplay.length > 0) {
                overallBehaviorStatsForDisplay.forEach(item => {
                    const row = tableBody.insertRow();
                    row.insertCell().textContent = item.behavior_category;
                    row.insertCell().textContent = item.count;
                    row.insertCell().textContent = `${item.percentage}%`;
                    row.insertCell().textContent = item.average_confidence.toFixed(2);
                });
            } else {
                tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">無可統計的詳細行為數據 (來自圖片高亮)。</td></tr>';
            }
        }

        // 渲染圓餅圖
        const pieChartContainer = document.getElementById('overallPieChartContainer');
        if (pieChartContainer && typeof Chart !== 'undefined') {
            if (overallBehaviorStatsForDisplay.length > 0) {
                const canvas = document.createElement('canvas');
                pieChartContainer.appendChild(canvas);
                try {
                    pieChartContainer.chartInstance = new Chart(canvas, {
                        type: 'pie',
                        data: {
                            labels: overallBehaviorStatsForDisplay.map(s => s.behavior_category),
                            datasets: [{
                                label: '整體行為分佈 (基於圖片高亮)',
                                data: overallBehaviorStatsForDisplay.map(s => s.count), // 使用實際次數繪製餅圖更有意義
                                backgroundColor: generateChartColors(overallBehaviorStatsForDisplay.length),
                                borderWidth: 1
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: {
                                legend: { position: 'top' },
                                tooltip: { callbacks: { label: function(context) {
                                    let label = context.label || '';
                                    if (label) { label += ': '; }
                                    if (context.parsed !== null) {
                                        // 找到對應的百分比
                                        const originalStat = overallBehaviorStatsForDisplay.find(s => s.behavior_category === context.label);
                                        const percentage = originalStat ? originalStat.percentage : 0;
                                        label += `${context.raw} 次 (${percentage.toFixed(1)}%)`;
                                    }
                                    return label;
                                } } }
                            }
                        }
                    });
                } catch (e) { console.error("Pie chart error:", e); pieChartContainer.textContent = "圓餅圖渲染錯誤"; }
            } else { pieChartContainer.textContent = '無數據可繪製圓餅圖 (來自圖片高亮)'; }
        } else if (pieChartContainer) { pieChartContainer.textContent = '圓餅圖無法加載 (Chart.js 未引入)'; }
    } else if (overallStatsSection) {
        overallStatsSection.style.display = 'block';
        overallStatsSection.innerHTML = '<h3>整體行為統計</h3><p>暫無序列分析數據可供統計。</p>';
    }

    // --- 4. 渲染行為隨時間變化趨勢 (折線圖) ---
    const lineChartContainer = document.getElementById('behaviorLineChartContainer');
    const behaviorTimelineSection = document.getElementById('behaviorTimelineSection');
    if (reportData.sequence_analysis_details && Array.isArray(reportData.sequence_analysis_details) && reportData.sequence_analysis_details.length > 0) {
        if(behaviorTimelineSection) behaviorTimelineSection.style.display = 'block';
        if (lineChartContainer && typeof Chart !== 'undefined') {
            const timelineData = prepareBehaviorTimelineDataFromSequences(reportData.sequence_analysis_details);
            if (timelineData && timelineData.labels && timelineData.labels.length > 0 && timelineData.datasets && timelineData.datasets.length > 0) {
                const canvas = document.createElement('canvas');
                lineChartContainer.appendChild(canvas);
                try {
                    lineChartContainer.chartInstance = new Chart(canvas, {
                        type: 'line', data: timelineData,
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            scales: { x: { title: { display: true, text: '圖片序列 (批次-圖序)' } },
                                      y: { title: { display: true, text: '主要行為標註 (1=是, 0=否)' }, beginAtZero: true, ticks: { stepSize: 1, callback: function(value) {if (Number.isInteger(value)) return value;} } } },
                            plugins: { legend: { position: 'top' } }
                        }
                    });
                } catch (e) { console.error("Line chart error:", e); lineChartContainer.textContent = "時間序列圖渲染錯誤"; }
            } else { lineChartContainer.textContent = '行為時間序列數據不足或格式錯誤'; }
        } else if (lineChartContainer) { lineChartContainer.textContent = '時間序列圖無法加載 (Chart.js 或數據問題)'; }
    } else if (behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'none';
    }

    // --- 5. 填充各圖片序列詳細行為分析 (與之前版本相同) ---
    const specificObsContainer = document.getElementById('specificImageObservationsContainer');
    const imageBehaviorDetailsSection = document.getElementById('imageBehaviorDetailsSection');
    if (imageBehaviorDetailsSection) {
        const sectionTitle = imageBehaviorDetailsSection.querySelector('h3');
        if(sectionTitle) sectionTitle.textContent = '各圖片序列詳細行為分析';
        if (reportData.sequence_analysis_details && Array.isArray(reportData.sequence_analysis_details) && reportData.sequence_analysis_details.length > 0) {
            imageBehaviorDetailsSection.style.display = 'block';
            if (specificObsContainer) {
                specificObsContainer.innerHTML = '';
                reportData.sequence_analysis_details.forEach(sequence => {
                    const div = document.createElement('div');
                    div.className = 'observation-block sequence-block';
                    let analysisHTML = `<h4>批次 ${sequence.batch_index} (圖片: ${escapeHtml(sequence.image_filenames_in_batch.join(', '))})</h4>`;
                    if (sequence.analysis && sequence.analysis.error) {
                        analysisHTML += `<p style="color:red;">此序列分析錯誤: ${escapeHtml(sequence.analysis.error)}</p>`;
                    } else if (sequence.analysis) {
                        const analysis = sequence.analysis;
                        if(analysis.sequence_analysis_confidence) { analysisHTML += `<p><small>序列分析總體信心: ${parseFloat(analysis.sequence_analysis_confidence).toFixed(2)}</small></p>`; }
                        analysisHTML += `<p><strong>序列總結:</strong> ${escapeHtml(analysis.sequence_summary || 'N/A')}</p>`;
                        if (analysis.dominant_sustained_behaviors && analysis.dominant_sustained_behaviors.length > 0) {
                            analysisHTML += '<p><strong>主要持續行為:</strong><ul>';
                            analysis.dominant_sustained_behaviors.forEach(beh => {
                                analysisHTML += `<li>${escapeHtml(beh.behavior_category)} (估計佔比: ${(parseFloat(beh.estimated_duration_ratio || 0) * 100).toFixed(0)}%) ${beh.description ? `<br><small><em>${escapeHtml(beh.description)}</em></small>` : ''}</li>`;
                            });
                            analysisHTML += '</ul></p>';
                        }
                        if (analysis.significant_behavior_shifts && analysis.significant_behavior_shifts.length > 0) {
                            analysisHTML += '<p><strong>顯著行為轉變:</strong><ul>';
                            analysis.significant_behavior_shifts.forEach(shift => {
                                analysisHTML += `<li>從圖片 ${shift.from_image_index || '?'} 到 ${shift.to_image_index || '?'}: ${escapeHtml(shift.shift_description || 'N/A')}</li>`;
                            });
                            analysisHTML += '</ul></p>';
                        }
                        if (analysis.per_image_highlights && analysis.per_image_highlights.length > 0) {
                            analysisHTML += '<p><strong>序列中關鍵圖片標註:</strong><ul>';
                            analysis.per_image_highlights.forEach(hl => {
                                analysisHTML += `<li>圖${hl.image_index_in_sequence}: ${escapeHtml(hl.behavior_category)} (信度: ${parseFloat(hl.confidence || 0).toFixed(2)}) ${hl.description ? `<br><small><em>${escapeHtml(hl.description)}</em></small>` : ''}</li>`;
                            });
                            analysisHTML += '</ul></p>';
                        }
                        if(analysis.general_sequence_atmosphere_hint){ analysisHTML += `<p><small>序列氛圍提示: ${escapeHtml(analysis.general_sequence_atmosphere_hint)}</small></p>`;}
                    } else { analysisHTML += '<p>此序列無有效分析數據。</p>'; }
                    div.innerHTML = analysisHTML;
                    specificObsContainer.appendChild(div);
                });
            }
        } else {
            imageBehaviorDetailsSection.style.display = 'block';
            if(specificObsContainer) specificObsContainer.innerHTML = '<p>暫無各圖片序列的詳細行為分析數據。</p>';
        }
    }
}

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
        'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)', 'rgba(255, 206, 86, 0.7)',
        'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)',
        'rgba(199, 199, 199, 0.7)', 'rgba(83, 102, 255, 0.7)', 'rgba(100, 255, 100, 0.7)'
        // 可以根據您的行為類別數量增加更多基礎顏色
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
         .replace(/'/g, "'");
}

function prepareBehaviorTimelineDataFromSequences(sequenceDataArray) {
    if (!sequenceDataArray || !Array.isArray(sequenceDataArray)) {
        console.warn("prepareBehaviorTimelineDataFromSequences: Input is not a valid array.");
        return { labels: [], datasets: [] };
    }
    const timelinePoints = [];
    const allBehaviorCategories = new Set();

    sequenceDataArray.forEach(sequence => {
        if (sequence.analysis && sequence.analysis.per_image_highlights && Array.isArray(sequence.analysis.per_image_highlights)) {
            sequence.analysis.per_image_highlights.forEach(highlight => {
                const timestampLabel = `B${sequence.batch_index}-P${highlight.image_index_in_sequence}`;
                if (highlight.behavior_category) {
                    timelinePoints.push({ timestamp: timestampLabel, behavior: highlight.behavior_category });
                    allBehaviorCategories.add(highlight.behavior_category);
                }
            });
        } else if (sequence.analysis && sequence.analysis.dominant_sustained_behaviors && Array.isArray(sequence.analysis.dominant_sustained_behaviors) && sequence.analysis.dominant_sustained_behaviors.length > 0) {
            const mainBeh = sequence.analysis.dominant_sustained_behaviors[0].behavior_category;
            const approxTimestamp = `B${sequence.batch_index}-Avg`;
            if (mainBeh) {
                timelinePoints.push({ timestamp: approxTimestamp, behavior: mainBeh });
                allBehaviorCategories.add(mainBeh);
            }
        }
    });

    if (allBehaviorCategories.size === 0) return { labels: [], datasets: [] };
    
    const uniqueLabels = [...new Set(timelinePoints.map(p => p.timestamp))];
    uniqueLabels.sort((a, b) => {
        const partsA = a.match(/B(\d+)-(P(\d+)|Avg)/);
        const partsB = b.match(/B(\d+)-(P(\d+)|Avg)/);
        if (partsA && partsB) {
            const batchA = parseInt(partsA[1]); const picA = partsA[3] ? parseInt(partsA[3]) : (a.includes("-Avg") ? Infinity : -1); // Avg 排在 P* 後, 或給一個大數字
            const batchB = parseInt(partsB[1]); const picB = partsB[3] ? parseInt(partsB[3]) : (b.includes("-Avg") ? Infinity : -1);
            if (batchA !== batchB) return batchA - batchB;
            return picA - picB;
        }
        return a.localeCompare(b);
    });

    const datasets = Array.from(allBehaviorCategories).map((category, index) => {
        const dataPoints = uniqueLabels.map(label => {
            let isBehaviorPresent = 0;
            timelinePoints.forEach(p => {
                if (p.timestamp === label && p.behavior === category) {
                    isBehaviorPresent = 1;
                }
            });
            return isBehaviorPresent;
        });
        const chartColors = generateChartColors(allBehaviorCategories.size);
        return {
            label: category, data: dataPoints,
            borderColor: chartColors[index % chartColors.length].replace('0.7', '1'),
            backgroundColor: chartColors[index % chartColors.length],
            fill: false, tension: 0.1, stepped: true,
        };
    });
    return { labels: uniqueLabels, datasets };
}

function setTextContent(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text !== null && typeof text !== 'undefined' ? String(text) : 'N/A';
    }
}

function generateChartColors(count) {
    const colors = [];
    const baseColors = [
        'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)', 'rgba(255, 206, 86, 0.7)',
        'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)',
        'rgba(199, 199, 199, 0.7)', 'rgba(83, 102, 255, 0.7)', 'rgba(100, 255, 100, 0.7)'
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

function prepareBehaviorTimelineDataFromSequences(sequenceDataArray) {
    if (!sequenceDataArray || !Array.isArray(sequenceDataArray)) {
        console.warn("prepareBehaviorTimelineDataFromSequences: Input is not a valid array.");
        return { labels: [], datasets: [] };
    }

    // 1. 定義核心狀態及其包含的細粒度行為 (與之前相同)
    const coreStatesMap = {
        "筆記": "專注學習", "目視桌面/教材": "專注學習", "目視前方": "專注學習",
        "翻閱書本": "專注學習", "坐姿直立": "專注學習", "身體前傾": "專注學習", "舉手": "專注學習",
        "玩弄物品": "非任務/分心", "目視他處": "非任務/分心", "趴睡": "非任務/分心",
        "喝水/飲食": "非任務/分心", "整理個人物品": "非任務/分心", "低頭/伏案(非睡)": "非任務/分心",
        "目視同學": "互動",
        "無明顯特定行為": "狀態不明/其他", "被遮擋/無法判斷": "狀態不明/其他"
    };
    const orderedCoreStates = ["專注學習", "互動", "非任務/分心", "狀態不明/其他"]; // Y軸的順序

    const timelineDataPoints = []; // 儲存 { x:時間標籤, y:核心狀態 }

    let globalImageIndex = 0; // 用於創建連續的X軸標籤

    sequenceDataArray.forEach(sequence => {
        let baseTimestampLabelForSequence = `B${sequence.batch_index}`;
        
        if (sequence.analysis && sequence.analysis.per_image_highlights && Array.isArray(sequence.analysis.per_image_highlights) && sequence.analysis.per_image_highlights.length > 0) {
            sequence.analysis.per_image_highlights.forEach(highlight => {
                const timestampLabel = `${baseTimestampLabelForSequence}-P${highlight.image_index_in_sequence}`;
                let assignedCoreState = "狀態不明/其他";
                if (highlight.behavior_category) {
                    assignedCoreState = coreStatesMap[highlight.behavior_category] || "狀態不明/其他";
                }
                timelineDataPoints.push({ x: timestampLabel, y: assignedCoreState, original_confidence: highlight.confidence });
                globalImageIndex++;
            });
        } else if (sequence.analysis && sequence.analysis.dominant_sustained_behaviors && Array.isArray(sequence.analysis.dominant_sustained_behaviors) && sequence.analysis.dominant_sustained_behaviors.length > 0) {
            // 如果沒有per_image_highlights，用dominant_sustained_behaviors的第一個作為該序列所有圖片的狀態
            const mainBehCat = sequence.analysis.dominant_sustained_behaviors[0].behavior_category;
            let assignedCoreState = coreStatesMap[mainBehCat] || "狀態不明/其他";
            const numImagesInBatch = sequence.image_filenames_in_batch ? sequence.image_filenames_in_batch.length : 1; // 假設至少一張
            for (let i = 0; i < numImagesInBatch; i++) {
                // 為批次中的每張圖片創建一個時間點（如果無法從文件名獲取更細粒度的時間戳）
                 const timestampLabel = `${baseTimestampLabelForSequence}-Img${i + 1}`; // 或者使用實際文件名
                timelineDataPoints.push({ x: timestampLabel, y: assignedCoreState, original_confidence: sequence.analysis.dominant_sustained_behaviors[0].estimated_duration_ratio }); // 用ratio作為近似confidence
                globalImageIndex++;
            }
        } else {
            // 如果一個序列完全沒有可分析的行為，可以跳過或標記為"狀態不明"
             const timestampLabel = `${baseTimestampLabelForSequence}-NoData`;
             timelineDataPoints.push({ x: timestampLabel, y: "狀態不明/其他" });
             globalImageIndex++;
        }
    });

    if (timelineDataPoints.length === 0) return { labels: [], datasets: [] };

    // X軸標籤 (所有獨立的時間點)
    // 嘗試保持原始順序，或者根據批次和圖片序號排序
    const labels = [...new Set(timelineDataPoints.map(p => p.x))].sort((a, b) => {
        const partsA = a.match(/B(\d+)-(P(\d+)|Img(\d+)|Avg|NoData)/);
        const partsB = b.match(/B(\d+)-(P(\d+)|Img(\d+)|Avg|NoData)/);
        if (partsA && partsB) {
            const batchA = parseInt(partsA[1]);
            const picA = parseInt(partsA[3] || partsA[4] || "0"); // P or Img number, Avg/NoData as 0
            const batchB = parseInt(partsB[1]);
            const picB = parseInt(partsB[3] || partsB[4] || "0");
            if (batchA !== batchB) return batchA - batchB;
            return picA - picB;
        }
        return a.localeCompare(b);
    });

    const datasets = orderedCoreStates.map((coreStateName, index) => {
        const data = [];
        labels.forEach(label => {
            // 找到該時間點對應的數據點
            const point = timelineDataPoints.find(p => p.x === label && p.y === coreStateName);
            // 對於甘特圖式的條形，我們需要在每個時間點上表示該狀態是否“活躍”
            // 這裡用 [start, end] 表示條形的範圍，對於單個時間點，可以認為 start 和 end 幾乎相同
            // Chart.js 的甘特圖通常需要 'gantt' 類型或特定插件，這裡用 'bar' indexAxis: 'y' 模擬
            // 數據點可以是 [該時間點的索引, 該時間點的索引 + 條形寬度]
            // 或者更簡單的方式：如果該狀態在該時間點活躍，則數據為1，否則為0或null
            if (point) {
                // 為了讓條形圖看起來像甘特圖，我們需要在Y軸(行為類別)上，
                // 在X軸(時間)的對應位置畫一個數據點。
                // 這裡的 data 數組長度應與 labels 數組長度一致。
                // 如果該 coreStateName 在該 label (時間點) 出現，則給一個值 (例如 1)，否則給 null 或 0。
                data.push(1); // 表示在該時間點，這個狀態是活躍的
            } else {
                data.push(null); // 或 0，表示不活躍
            }
        });

        const chartColors = generateChartColors(orderedCoreStates.length);
        return {
            label: coreStateName,
            data: data, // 數據是 1 或 null/0 的數組
            backgroundColor: chartColors[index % chartColors.length],
            // borderColor: chartColors[index % chartColors.length].replace('0.7', '1'),
            // borderWidth: 1,
            barPercentage: 1.0, // 讓條形填滿分配的空間
            categoryPercentage: 0.8 // 條形之間的間距
        };
    });
    
    // 過濾掉完全沒有數據的 datasets (可選，但如果一個核心狀態從未出現，則沒必要顯示)
    const finalDatasets = datasets.filter(ds => ds.data.some(point => point !== null && point > 0));


    return { labels: labels, datasets: finalDatasets };
}