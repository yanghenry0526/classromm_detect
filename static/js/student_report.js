// static/js/student_report.js

// --- 全局變量用於追踪標籤頁停留時間 ---
let currentOpenTabId = null;
let currentTabStartTime = null;
let current_user_id_for_beacon = null; 
const current_user_is_authenticated_in_js = true; // 假設用戶已登入
let searchLogTimeout = null;

// --- 輔助函數 ---
function setTextContent(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text !== null && typeof text !== 'undefined' ? String(text) : 'N/A';
    }
}

function summarizeBehaviorStats(detailedStats) {
    // 根據您之前確認的分類法
    const categories = {
        "正向": ["做筆記", "主動舉手", "目視教師", "目視黑板", "目視書本/筆記", "坐姿直立", "身體前傾"],
        "負向": ["趴睡", "玩弄手部/文具", "目視他處", "目視同學", "低頭(非學習)"],
        "中性": ["喝水", "飲食", "翻書", "被動舉手", "被遮擋/無法判斷", "托腮", "身體後靠", "觸摸臉部", "觸摸頭髮", "玩弄手部／文具"] // 兼容全形斜線
    };

    const summary = {
        "正向": { totalPercentage: 0, weightedConfidenceSum: 0, details: [] },
        "負向": { totalPercentage: 0, weightedConfidenceSum: 0, details: [] },
        "中性": { totalPercentage: 0, weightedConfidenceSum: 0, details: [] }
    };

    // 遍歷原始數據
    detailedStats.forEach(item => {
        let foundCategory = null;
        // 判斷當前細項屬於哪個大類
        if (categories["正向"].includes(item.behavior_category)) {
            foundCategory = "正向";
        } else if (categories["負向"].includes(item.behavior_category)) {
            foundCategory = "負向";
        } else if (categories["中性"].includes(item.behavior_category)) {
            foundCategory = "中性";
        }

        if (foundCategory) {
            const percentage = parseFloat(item.percentage) || 0;
            const confidence = parseFloat(item.average_confidence) || 0;

            summary[foundCategory].totalPercentage += percentage;
            summary[foundCategory].weightedConfidenceSum += percentage * confidence; // 用百分比作為權重
            summary[foundCategory].details.push(item);
        }
    });

    // 計算加權平均可信度
    for (const category in summary) {
        if (summary[category].totalPercentage > 0) {
            summary[category].averageConfidence = summary[category].weightedConfidenceSum / summary[category].totalPercentage;
        } else {
            summary[category].averageConfidence = 0;
        }
    }
    
    return summary;
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


function prepareGanttChartData(sequenceDataArray) {
    if (!sequenceDataArray || !Array.isArray(sequenceDataArray)) {
        return { yLabels: [], datasets: [] };
    }

    const valenceStates = {
        '正向': { color: 'rgba(75, 192, 192, 0.7)', behaviors: new Set(["做筆記", "主動舉手", "目視教師", "目視黑板", "目視書本/筆記", "坐姿直立", "身體前傾"]) },
        '負向': { color: 'rgba(255, 99, 132, 0.7)', behaviors: new Set(["趴睡", "玩弄手部/文具", "目視他處", "目視同學", "低頭(非學習)", "玩弄手部／文具"]) },
        '中性': { color: 'rgba(255, 206, 86, 0.7)', behaviors: new Set(["喝水", "飲食", "翻書", "被動舉手", "被遮擋/無法判斷", "托腮", "身體後靠", "觸摸臉部", "觸摸頭髮"]) }
    };
    const orderedYLabels = ['正向', '中性', '負向'];
    const behaviorToValenceMap = {};
    orderedYLabels.forEach(state => {
        valenceStates[state].behaviors.forEach(behavior => {
            behaviorToValenceMap[behavior] = state;
        });
    });

    // ✨ 1. 為每個分類創建一個空的數據點列表
    const dataPoints = {
        '正向': [],
        '中性': [],
        '負向': []
    };

    sequenceDataArray.forEach(sequence => {
        if (sequence.analysis && Array.isArray(sequence.analysis.per_image_highlights)) {
            sequence.analysis.per_image_highlights.forEach(hl => {
                const behaviorCats = Array.isArray(hl.behavior_category) ? hl.behavior_category : [hl.behavior_category];
                const imageIndex = hl.image_index_in_sequence;
                let filename;
                if (typeof imageIndex === 'number' && imageIndex >= 0 && imageIndex < sequence.image_filenames_in_batch.length) {
                    filename = sequence.image_filenames_in_batch[imageIndex];
                } else if (typeof imageIndex === 'number' && imageIndex > 0 && imageIndex <= sequence.image_filenames_in_batch.length) {
                    filename = sequence.image_filenames_in_batch[imageIndex - 1];
                }

                if (behaviorCats.length > 0 && filename) {
                    const timestamp = parseTimeToSeconds(filename);
                    if (timestamp !== null) {
                        // ✨ 2. 遍歷當前時間點的所有行為
                        behaviorCats.forEach(cat => {
                            const valenceState = behaviorToValenceMap[cat];
                            if (valenceState) {
                                // ✨ 3. 為每個行為在對應的分類中添加一個數據點
                                dataPoints[valenceState].push({
                                    x: timestamp,
                                    y: valenceState,
                                    behavior: cat // 將具體行為儲存起來，用於 tooltip
                                });
                            }
                        });
                    }
                }
            });
        }
    });

    // ✨ 4. 將數據點轉換為 Chart.js 的 datasets 格式
    const datasets = orderedYLabels.map(label => ({
        label: label,
        data: dataPoints[label],
        backgroundColor: valenceStates[label].color,
        borderColor: valenceStates[label].color,
        pointRadius: 5, // 點的大小
        pointHoverRadius: 7
    }));
    
    return { yLabels: orderedYLabels, datasets: datasets };
}

// --- 日誌記錄函數 ---
function logStudentActivity(eventType, elementOrPageId, durationInSeconds) {
    if (!current_user_is_authenticated_in_js) return;

    // 如果是切換分頁，統一呼叫新的 page_access 路由
    if (eventType.startsWith('tab_view')) {
        sendAnalyticsLog('/api/log/page_access', {
            page_name: elementOrPageId,
            duration: durationInSeconds || 0,
            report_date: window.currentReportDateStr || "none"
        });
    } else {
        // 如果是其他的點擊(click)，發送到 interaction 路由
        sendAnalyticsLog('/api/log/note_interaction', {
            action_type: eventType,
            target_topic: elementOrPageId,
            report_date: window.currentReportDateStr || "none"
        });
    }
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
        const durationSec = Math.round((endTime - currentTabStartTime) / 1000);
        
        // 發送到 PageAccessLog
        sendAnalyticsLog('/api/log/page_access', {
            page_name: currentOpenTabId,
            duration: durationSec,
            report_date: window.currentReportDateStr || "none" // 紀錄看哪天的報告
        });
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

    const reportSelectorArea = document.getElementById('reportSelectorArea');
    if (reportSelectorArea) {
        if (tabIdToOpen === 'knowledgeHubTab') {
            reportSelectorArea.style.display = 'none'; // 進入筆記頁籤時隱藏
            
            // 如果是用戶第一次點進來，且還沒有生成圖書館，則初始化圖書館
            const libraryContainer = document.getElementById('knowledgeCardGrid');
            if (libraryContainer && libraryContainer.children.length <= 1) { // 只有預設文字時
                initKnowledgeLibrary();
            }
        } else {
            reportSelectorArea.style.display = 'flex'; // 其他頁籤顯示
        }
    }
}

// 1. 切換 總覽/閱讀 視圖
function switchKnowledgeView(viewName) {
    const libraryView = document.getElementById('knowledgeLibraryView');
    const readerView = document.getElementById('knowledgeReaderView');
    
    if (viewName === 'reader') {
        libraryView.style.display = 'none';
        readerView.style.display = 'block';
        // 滾動到頂部
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        libraryView.style.display = 'block';
        readerView.style.display = 'none';
    }
}

// 2. 初始化知識圖書館 (生成卡片牆)
async function initKnowledgeLibrary() {
    const gridContainer = document.getElementById('knowledgeCardGrid');
    
    try {
        const response = await fetch('/api/student/all_notes_index');
        if (!response.ok) throw new Error('無法獲取課程索引');
        
        const allNotesIndex = await response.json();
        window.g_allNotesIndex = allNotesIndex; // 存入全域變數供側邊欄使用

        if (allNotesIndex && allNotesIndex.length > 0) {
            
            // 先進行資料過濾：只保留有內容 (topics) 的課程
            const validNotes = allNotesIndex.filter(note => note.topics && note.topics.length > 0);

            if (validNotes.length === 0) {
                gridContainer.innerHTML = '<p>目前沒有可顯示的課程筆記。</p>';
                return;
            }

            gridContainer.innerHTML = ''; // 清空載入文字

            validNotes.forEach(note => {
                // 構建卡片 HTML
                const card = document.createElement('div');
                card.className = 'course-card';
                // 點擊卡片 -> 進入閱讀模式
                card.onclick = () => loadReportFromCard(note.behavior_report_filename, note.display_name);

                // 【核心修改】不再截斷 topics，而是映射所有 topics
                const allTopicsList = note.topics.map(t => `<li>${escapeHtml(t.name)}</li>`).join('');
                
                // 處理標題：移除 "報告 - " 字樣
                const cleanTitle = note.display_name.replace('報告 - ', '').trim();

                card.innerHTML = `
                    <div>
                        <div class="course-title" style="margin-top: 5px;">${escapeHtml(cleanTitle)}</div>
                        <div class="course-topics-preview">
                            <ul>${allTopicsList}</ul>
                        </div>
                    </div>
                    <div style="text-align:right; margin-top:15px; color:#4a90e2; font-weight:bold;">
                        查看筆記 →
                    </div>
                `;
                gridContainer.appendChild(card);
            });
            
            setupGlobalSearch(); 
            // 同時也填充側邊欄 (為了閱讀模式準備)
            // populateSidebarIndex(validNotes);

        } else {
            gridContainer.innerHTML = '<p>暫無課程筆記資料。</p>';
        }
    } catch (error) {
        console.error("初始化圖書館失敗:", error);
        gridContainer.innerHTML = '<p style="color:red;">載入失敗，請重新整理頁面。</p>';
    }
}

async function loadReportFromCard(filename, displayName) {
    console.log(`準備載入報告: ${filename}`);

    // A. 設定閱讀區標題
    const titleEl = document.getElementById('currentReaderTitle');
    if(titleEl) titleEl.textContent = displayName;

    // B. 切換到閱讀視圖 (隱藏卡片牆，顯示詳細內容區)
    switchKnowledgeView('reader');

    // C. 同步頂部下拉選單 (讓使用者知道現在是哪一天的報告)
    const reportSelector = document.getElementById('reportSelector');
    if (reportSelector) {
        reportSelector.value = filename;
    }

    // D. 呼叫核心載入函式
    // 注意：這裡我們不需要傳入 callback，因為預設行為就是渲染內容
    await window.loadAndDisplayReport(filename, () => {
        // 載入完成後的回調：確保停留在 'AI 課堂筆記' 頁籤
        openTab(null, 'knowledgeHubTab');
        
        // 再次確保顯示閱讀視圖 (雙重保險)
        switchKnowledgeView('reader');
    });
}

function setupGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    
    if (!input) return;

    // 監聽輸入事件 (加入一點防抖 Debounce 會更好，這裡先用簡單版)
    input.addEventListener('input', function(e) {
        const keyword = e.target.value.trim();
        performGlobalSearch(keyword);
        
        // 控制清除按鈕顯示
        if (clearBtn) clearBtn.style.display = keyword ? 'block' : 'none';
    });

    // 清除按鈕事件
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            input.value = '';
            performGlobalSearch(''); // 清空搜尋
            this.style.display = 'none';
            input.focus();
        });
    }
}

// 3. 執行搜尋邏輯
function performGlobalSearch(keyword) {
    const cardGrid = document.getElementById('knowledgeCardGrid');
    const resultsArea = document.getElementById('globalSearchResults');
    const resultList = document.getElementById('searchResultList');
    const countSpan = document.getElementById('searchResultCount');

    if (!keyword) {
        cardGrid.style.display = 'grid'; 
        resultsArea.style.display = 'none';
        return;
    }

    cardGrid.style.display = 'none';
    resultsArea.style.display = 'block';
    resultList.innerHTML = '';

    if (!window.g_allNotesIndex) return;

    let matchCount = 0;
    const lowerKeyword = keyword.toLowerCase();

    window.g_allNotesIndex.forEach(note => {
        if (!note.topics) return;

        // 【關鍵修正 1】從 display_name (例如 "報告 - 2025年09月28日") 解析出 "2025-09-28"
        // 這樣才能拿到正確的課程日期，而不是報告生成的日期
        let cleanDate = '';
        const dateMatch = note.display_name.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
            cleanDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        } else {
            // 如果解析失敗，才勉強用檔名 (備用方案)
            cleanDate = note.behavior_report_filename;
        }

        note.topics.forEach(topic => {
            if (topic.name && topic.name.toLowerCase().includes(lowerKeyword)) {
                matchCount++;
                
                const item = document.createElement('div');
                item.className = 'search-result-item';
                
                const regex = new RegExp(`(${keyword})`, 'gi');
                const highlightedName = topic.name.replace(regex, '<span class="highlight-text">$1</span>');
                const dateText = note.display_name.replace('報告 - ', '');

                item.innerHTML = `
                    <div class="result-header" style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div class="result-date-tag">${escapeHtml(dateText)}</div>
                            <div class="result-topic-title">${highlightedName}</div>
                        </div>
                        <div class="expand-icon" style="color:#999; transition:transform 0.3s;">▼</div>
                    </div>
                    <div class="search-result-body" style="display:none; margin-top:10px; border-top:1px dashed #eee; padding-top:10px;"></div>
                    <div style="font-size:0.85em; color:#4a90e2; margin-top:8px; text-align:right;">
                        <span class="click-hint">點擊展開閱讀</span>
                    </div>
                `;

                item.onclick = function(e) {
                    if(e.target.tagName === 'IMG') return;
                    // 【關鍵修正 2】這裡直接傳入解析好的 cleanDate，而不是 filename
                    toggleSearchAccordion(this, cleanDate, topic.name, topic.anchor_id);
                };

                resultList.appendChild(item);
            }
        });
    });

    countSpan.textContent = matchCount;

    if (matchCount === 0) {
        resultList.innerHTML = `<div style="text-align:center; padding: 40px; color: #888;"><p>找不到包含「${escapeHtml(keyword)}」的知識點。</p></div>`;
    }

    clearTimeout(searchLogTimeout);
    if (keyword.length >= 2) { // 關鍵字大於2個字才紀錄
        searchLogTimeout = setTimeout(() => {
            sendAnalyticsLog('/api/log/note_interaction', {
                action_type: 'search_note',
                search_query: keyword,
                report_date: window.currentReportDateStr || "all_notes"
            });
        }, 2000); // 使用者停止輸入2秒後發送
    }
}

async function toggleSearchAccordion(cardElement, reportDate, topicName, anchorId) {
    const bodyElement = cardElement.querySelector('.search-result-body');
    const hintSpan = cardElement.querySelector('.click-hint');
    const expandIcon = cardElement.querySelector('.expand-icon');

    if (!bodyElement) return;

    // 1. 收合邏輯
    if (cardElement.classList.contains('expanded')) {
        cardElement.classList.remove('expanded');
        bodyElement.style.display = 'none';
        if (hintSpan) hintSpan.textContent = '點擊展開閱讀';
        if (expandIcon) expandIcon.style.transform = 'rotate(0deg)';
        return;
    }

    // --- 展開邏輯 ---
    // 這裡我們把 reportDate 印出來，這次應該要是 2025-09-28 了
    console.log(`[展開] 正在載入日期: ${reportDate}, 尋找主題: ${topicName}`);
    
    cardElement.classList.add('expanded');
    if (hintSpan) hintSpan.textContent = '點擊收合';
    if (expandIcon) expandIcon.style.transform = 'rotate(180deg)';

    if (bodyElement.innerHTML.trim() !== '') {
        bodyElement.style.display = 'block';
        return;
    }

    bodyElement.style.display = 'block';
    bodyElement.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">⏳ 正在擷取知識點內容...</div>';

    try {
        // 【關鍵修正】不需要再解析檔名了，直接用傳進來的 reportDate
        // reportDate 應該已經是 "2025-09-28" 格式
        
        const response = await fetch(`/api/student/get_note_report_for_date?date=${encodeURIComponent(reportDate)}`);
        const data = await response.json();

        console.log("API回傳資料:", data); // 檢查這裡是否還有 error

        if (data.error) throw new Error(data.error);

        const allTopics = data.knowledge_hub_content || [];
        
        const targetTopic = allTopics.find(t => {
            if (!t.main_topic) return false;
            const tIsObject = typeof t.main_topic === 'object';
            const tName = tIsObject ? t.main_topic.name : t.main_topic;
            const tId = tIsObject ? t.main_topic.anchor_id : null;

            if (anchorId && tId && String(anchorId) === String(tId)) return true;
            if (tName && topicName) {
                return String(tName).replace(/\s/g, '') === String(topicName).replace(/\s/g, '');
            }
            return false;
        });

        if (targetTopic) {
            let htmlContent = '';
            if (targetTopic.content_blocks && Array.isArray(targetTopic.content_blocks)) {
                const renderedPaths = new Set();
                targetTopic.content_blocks.forEach(block => {
                    if (!block) return;
                    if (block.type === 'text') {
                        const textContent = block.content || "";
                        const renderedHtml = (typeof renderSimpleMarkdown === 'function') 
                                           ? renderSimpleMarkdown(textContent) 
                                           : textContent;
                        htmlContent += `<div class="note-text-block" style="margin-bottom:15px; line-height:1.6; color:#333;">${renderedHtml}</div>`;
                    } else if (block.type === 'image') {
                        const imgPath = block.path || block.image;
                        if (imgPath && !renderedPaths.has(imgPath)) {
                            renderedPaths.add(imgPath);
                            const imgName = imgPath.split(/[/\\]/).pop();
                            const imgUrl = `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imgName)}`;
                            const desc = block.description || '相關板書';
                            htmlContent += `<div class="note-image-block" style="margin:10px 0; text-align:center;">
                                    <img src="${imgUrl}" alt="${escapeHtml(desc)}" class="zoomable-image" loading="lazy" style="max-width:100%; border:1px solid #ddd; border-radius:5px;" onerror="this.style.display='none';">
                                    <p style="font-size:0.85em; color:#888; margin-top:5px;">${escapeHtml(desc)}</p>
                                </div>`;
                        }
                    }
                });
            } else {
                if (targetTopic.refined_transcript_content) {
                     htmlContent += `<div class="note-text-block">${renderSimpleMarkdown(targetTopic.refined_transcript_content)}</div>`;
                } else {
                     htmlContent = '<p style="padding:15px; color:#666;">(此知識點暫無詳細內容區塊)</p>';
                }
            }
            bodyElement.innerHTML = htmlContent;
        } else {
            console.warn("[失敗] 在該日報告中找不到主題:", topicName);
            bodyElement.innerHTML = `<p style="color:red; padding:15px;">找不到該知識點詳細內容 (日期: ${reportDate})。</p>`;
        }

    } catch (err) {
        console.error("載入失敗:", err);
        bodyElement.innerHTML = `<p style="color:red; padding:15px;">載入失敗: ${escapeHtml(err.message)}</p>`;
    }
    
    bodyElement.style.display = 'block';
    bodyElement.style.height = 'auto';
}

// 3. 從卡片點擊載入報告 (取代原本的 jumpToTopic 邏輯)
async function jumpToTopic(filename, targetTabId, anchorId) {
    // 1. 判斷是否已經在查看該日期的報告
    if (window.currentReportFilename === filename) {
        // A. 如果是同一份報告，直接切換頁籤並滾動
        openTab(null, targetTabId);
        
        // 如果是筆記頁籤，確保切換到閱讀模式
        if (targetTabId === 'knowledgeHubTab') {
            switchKnowledgeView('reader');
        }

        // 稍微延遲以確保 DOM 渲染完成
        setTimeout(() => scrollToAnchor(anchorId), 100);
    } else {
        // B. 如果是不同報告，才需要重新載入
        await window.loadAndDisplayReport(filename, () => {
            openTab(null, targetTabId);
            if (targetTabId === 'knowledgeHubTab') {
                switchKnowledgeView('reader');
            }
            setTimeout(() => scrollToAnchor(anchorId), 100);
        });
    }
}

// 4. 填充側邊欄索引 (含搜尋功能支援)
function populateSidebarIndex(allNotesIndex) {
    const container = document.getElementById('relatedTopicsContainer');
    if (!container) return;

    let htmlContent = '<div class="topics-index-list">';
    
    allNotesIndex.forEach(note => {
        if (!note.behavior_report_filename) return;

        const filenameParam = `'${escapeHtml(note.behavior_report_filename)}'`;
        const displayNameParam = `'${escapeHtml(note.display_name)}'`;

        // 日期標題 (點擊也可以跳轉該報告)
        htmlContent += `
            <h4 class="topic-date-heading" 
                onclick="loadReportFromCard(${filenameParam}, ${displayNameParam})" 
                style="cursor:pointer;"
                data-search="${escapeHtml(note.display_name)}">
                ${escapeHtml(note.display_name)}
            </h4>
        `;
        
        if (note.topics && note.topics.length > 0) {
            htmlContent += `<ul class="topic-list">`;
            note.topics.forEach(topic => {
                if (!topic.anchor_id || !topic.name) return;
                
                // 點擊側邊欄主題 -> 1. 載入報告(若不同) 2. 捲動到錨點
                // 這裡我們稍微修改邏輯：如果已經在當前報告，就只捲動；否則載入新報告
                htmlContent += `
                    <li data-search="${escapeHtml(topic.name)}">
                        <a href="#" onclick="event.preventDefault(); handleSidebarClick(${filenameParam}, '${escapeHtml(topic.anchor_id)}', '${escapeHtml(note.display_name)}')">
                            ${escapeHtml(topic.name)}
                        </a>
                    </li>
                `;
            });
            htmlContent += `</ul>`;
        }
    });

    htmlContent += '</div>';
    container.innerHTML = htmlContent;
}

// 5. 處理側邊欄點擊 (智慧判斷是否需要重新載入)
async function handleSidebarClick(targetFilename, anchorId, displayName) {
    // 獲取當前正在顯示的報告檔名 (這需要您在 loadAndDisplayReport 時存到某個全域變數，例如 window.currentReportFilename)
    // 假設您在 loadAndDisplayReport 裡加了一行 window.currentReportFilename = filename;
    
    if (window.currentReportFilename !== targetFilename) {
        // 如果點的是別天的報告，先載入
        await loadReportFromCard(targetFilename, displayName);
        // 給一點時間讓 DOM 渲染
        setTimeout(() => scrollToAnchor(anchorId), 500);
    } else {
        // 如果是同一天的，直接捲動
        scrollToAnchor(anchorId);
    }
}

function scrollToAnchor(anchorId) {
    const element = document.getElementById(anchorId);
    if (element) {
        // 展開手風琴
        const button = element.previousElementSibling;
        if (button && !button.classList.contains('active')) {
            button.click();
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 視覺回饋 (閃爍一下)
        element.style.backgroundColor = '#fff3cd';
        setTimeout(() => element.style.backgroundColor = '', 1500);
    }
}

// 6. 側邊欄搜尋過濾功能
function filterTopics() {
    const input = document.getElementById('topicSearchInput');
    const filter = input.value.toUpperCase();
    const container = document.getElementById('relatedTopicsContainer');
    
    const dates = container.getElementsByTagName('h4');
    const listItems = container.getElementsByTagName('li');

    // 簡單過濾邏輯：如果有匹配文字就顯示，否則隱藏
    // 這裡可以做細一點：如果下面的 li 有匹配，上面的 h4 也要顯示
    
    // 先重置所有顯示
    for (let h4 of dates) h4.style.display = "";
    for (let li of listItems) li.style.display = "";

    if (filter === "") return;

    // 隱藏不匹配的 LI
    for (let li of listItems) {
        const txtValue = li.getAttribute('data-search') || li.textContent;
        if (txtValue.toUpperCase().indexOf(filter) > -1) {
            li.style.display = "";
        } else {
            li.style.display = "none";
        }
    }
    
    // 處理 H4 (標題)：如果該標題下的所有 LI 都隱藏了，且標題本身也不匹配，就隱藏標題
    // 這部分邏輯稍微複雜，為了簡化，目前先只過濾 LI，標題常駐或簡單過濾
}

// 7. 輔助：高亮當前正在看的日期 (在側邊欄)
function highlightCurrentSidebarDate(displayName) {
    const headers = document.querySelectorAll('.topic-date-heading');
    headers.forEach(h => {
        if (h.textContent.includes(displayName)) {
            h.style.color = '#4a90e2';
            h.style.borderBottomColor = '#4a90e2';
        } else {
            h.style.color = '';
            h.style.borderBottomColor = '';
        }
    });
}

// --- 主邏輯：頁面加載完成後執行 ---
document.addEventListener('DOMContentLoaded', async function() {
    // 1. 獲取所有必要的頁面元素
    const reportDisplayArea = document.getElementById('reportDisplayArea');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDisplay = document.getElementById('errorMessage');
    const reportSelector = document.getElementById('reportSelector');
    const loadReportButton = document.getElementById('loadReportButton');
    
    // 頁面元素基礎檢查
    if (!reportDisplayArea || !loadingMessage || !errorMessageDisplay || !reportSelector || !loadReportButton) {
        console.error("頁面初始化錯誤：缺少關鍵的報告顯示組件。");
        if(errorMessageDisplay) {
            errorMessageDisplay.textContent = "頁面初始化錯誤，請聯繫管理員。";
            errorMessageDisplay.style.display = 'block';
        }
        return;
    }

    // 2. 【【【 核心修改：將 loadAndDisplayReport 函式定義移到頂部 】】】
    // 這樣後續的程式碼在任何時候呼叫它，都能確保它已經被定義
    window.loadAndDisplayReport = async function(filename, onCompleteCallback = null) {
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

        window.currentReportFilename = filename; 

        try {
            // 步驟 A: 獲取行為報告數據
            const behaviorResponse = await fetch(`/api/student/report?report_file=${encodeURIComponent(filename)}`);
            if (!behaviorResponse.ok) throw new Error(`獲取行為報告失敗 (HTTP ${behaviorResponse.status})`);
            const behaviorReportData = await behaviorResponse.json();
            if (behaviorReportData.error) throw new Error(behaviorReportData.error);
            
            // 步驟 B: 填充行為報告相關內容
            populateStudentBehaviorReport(behaviorReportData, filename);

            // 步驟 C: 根據行為報告的日期，異步獲取課堂筆記與練習冊數據
            const metadata = behaviorReportData.report_metadata || {};
            const reportDateStr = getStandardDate(metadata.report_generation_time);
            
            console.log(`[診斷] 正在為行為報告解析出的日期是: ${reportDateStr}`);

            window.currentReportDateStr = reportDateStr; 

            if (reportDateStr) {
                // 使用 Promise.all 並行加載筆記和練習冊，可以稍微提升速度
                await Promise.all([
                    populateKnowledgeHub(reportDateStr),
                    populateWorkbook(reportDateStr)
                ]);
            } else {
                 const hubContainer = document.getElementById('knowledgeHubContainer');
                 if (hubContainer) {
                    hubContainer.innerHTML = '<p class="text-center">無法從行為報告中確定日期，無法加載課堂筆記。</p>';
                 }
                 const workbookContainer = document.getElementById('workbookContainer');
                 if (workbookContainer) {
                    workbookContainer.innerHTML = '<p class="text-center">無法從行為報告中確定日期，無法加載練習。</p>';
                 }
            }
            if (!currentOpenTabId) {
                currentOpenTabId = 'behaviorOverviewTab'; 
            }
            currentTabStartTime = new Date(); 
            
            // 步驟 D: 所有數據都準備好後，才顯示內容
            loadingMessage.style.display = 'none';
            reportDisplayArea.style.display = 'block';
            
            // 【修正邏輯開始】
            if (typeof onCompleteCallback === 'function') {
                // 情境 1：如果有傳入 callback (例如從卡片牆點擊)，就只執行 callback
                // 這樣就不會執行下面的預設跳轉，避免跳回「行為總覽」
                onCompleteCallback();
            } else {
                // 情境 2：沒有 callback (例如使用者直接操作頂部下拉選單)
                
                // 檢查當前是否已經在某個頁籤上
                if (currentOpenTabId) {
                    // 如果已經在某個頁籤 (例如使用者在「AI 練習」頁籤切換日期)
                    // 我們就停留在當前頁籤，只刷新數據
                    openTab(null, currentOpenTabId);
                } else {
                    // 只有在第一次載入，或狀態不明確時，才預設跳轉到第一個頁籤 (行為總覽)
                    const firstTabButton = document.querySelector('.tab-navigation .tab-button');
                    if (firstTabButton) {
                        firstTabButton.click();
                    }
                }
            }
            if (!currentOpenTabId) {
            currentOpenTabId = 'behaviorOverviewTab'; 
            currentTabStartTime = new Date();
        }
        } catch (error) {
            console.error(`加載報告 ${filename} 失敗:`, error);
            loadingMessage.style.display = 'none';
            errorMessageDisplay.textContent = `無法加載報告: ${escapeHtml(error.message)}`;
            errorMessageDisplay.style.display = 'block';
        }
    };
    // --- 函式定義結束 ---

    
    // 3. 頁面初始化主流程
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
        // 步驟 A: 異步獲取報告列表
        const response = await fetch('/api/student/reports_list');
        if (!response.ok) throw new Error(`獲取報告列表失敗 (HTTP ${response.status})`);
        const reports = await response.json();
        if (reports.error) throw new Error(reports.error);

        // 步驟 B: 填充下拉選單
        reportSelector.innerHTML = '';
        if (reports && reports.length > 0) {
            reports.forEach(report => {
                const option = document.createElement('option');
                option.value = report.filename;
                option.textContent = report.display_name;
                reportSelector.appendChild(option);
            });
            loadReportButton.disabled = false;
            
            // 步驟 C: 【新增功能】加載並顯示相關主題索引
            // populateRelatedTopicsIndex();
            
            // 步驟 D: 異步加載並顯示最新的報告
            // 現在呼叫時，loadAndDisplayReport 函式保證已經被定義
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

    // 4. 為“查看報告”按鈕添加事件監聽
    loadReportButton.addEventListener('click', function() {
        const selectedFilename = reportSelector.value;
        if (selectedFilename) {
            logStudentActivity('click', `button_load_report_${selectedFilename}`);
            loadAndDisplayReport(selectedFilename);
        }
    });
});

function populateStudentBehaviorReport(reportData, reportFilename) {
    console.log("Populating report with data for:", reportFilename);

    // --- 步驟 0: 清理可能存在的舊圖表實例 ---
    ['stackedBarChartContainer', 'behaviorLineChartContainer'].forEach(containerId => {
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
    
    // --- 步驟 2: 填充 AI 觀察與建議 ---
    const summaryNotesSection = document.getElementById('summaryNotesSection');
    const notes = reportData.overall_summary ? reportData.overall_summary.ai_summary_notes : null;
    if (notes && summaryNotesSection) {
        summaryNotesSection.style.display = 'block';
        setTextContent('analysisSummaryText', notes.analysis_summary);
        const actionPlanList = document.getElementById('actionPlanList');
        if (actionPlanList && Array.isArray(notes.action_plan)) {
            actionPlanList.innerHTML = '<ul>' + notes.action_plan.map(item => `<li>${escapeHtml(item)}</li>`).join('') + '</ul>';
        }
        setTextContent('finalWordText', notes.final_word);
    } else if (summaryNotesSection) {
        summaryNotesSection.style.display = 'none';
    }

    // --- 步驟 3: 處理並渲染「整體行為統計」區塊 ---
    const overallStatsSection = document.getElementById('overallBehaviorStatisticsSection');
    const rawStats = reportData.overall_summary ? reportData.overall_summary.behavior_statistics : null;
    
    // 【新增】獲取後端傳來的班級平均數據
    const classAvgStats = reportData.class_average_summary || [];
    const studentCount = reportData.class_student_count || 0;

    if (rawStats && overallStatsSection) {
        overallStatsSection.style.display = 'block';
        
        // 1. 計算學生的分類數據
        const studentSummary = summarizeBehaviorStats(rawStats);
        
        // 2. 【新增】計算班級平均的分類數據
        // 我們可以重用 summarizeBehaviorStats 函數，因為資料結構是一樣的
        const classSummary = summarizeBehaviorStats(classAvgStats);

        // 渲染【堆疊長條圖】
        const stackedBarContainer = document.getElementById('stackedBarChartContainer');
        if (stackedBarContainer && typeof Chart !== 'undefined') {
            if (stackedBarContainer.chartInstance) {
                stackedBarContainer.chartInstance.destroy();
            }
            stackedBarContainer.innerHTML = '';

            const canvas = document.createElement('canvas');
            stackedBarContainer.appendChild(canvas);
            
            stackedBarContainer.chartInstance = new Chart(canvas, {
                type: 'bar',
                data: {
                    // 【修改】這裡變成了兩個標籤，代表有兩條 Bar
                    labels: ['我的狀態', `全班平均 (${studentCount}人)`], 
                    datasets: [
                        { 
                            label: '正向行為', 
                            // 【修改】資料變成陣列：[學生的正向%, 班級的正向%]
                            data: [studentSummary['正向'].totalPercentage, classSummary['正向'].totalPercentage], 
                            backgroundColor: 'rgba(75, 192, 192, 0.8)',
                            // 【修改】細項資料也變成陣列：[學生的細項, 班級的細項]
                            customDetails: [studentSummary['正向'].details, classSummary['正向'].details],
                            barThickness: 30, // 稍微調細一點，因為現在有兩條
                        },
                        { 
                            label: '中性行為', 
                            data: [studentSummary['中性'].totalPercentage, classSummary['中性'].totalPercentage], 
                            backgroundColor: 'rgba(201, 203, 207, 0.8)',
                            customDetails: [studentSummary['中性'].details, classSummary['中性'].details],
                            barThickness: 30,
                        },
                        { 
                            label: '負向行為', 
                            data: [studentSummary['負向'].totalPercentage, classSummary['負向'].totalPercentage], 
                            backgroundColor: 'rgba(255, 99, 132, 0.8)',
                            customDetails: [studentSummary['負向'].details, classSummary['負向'].details],
                            barThickness: 30,
                        }
                    ]
                },
                options: {
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'top' }, 
                        tooltip: { 
                            backgroundColor: 'rgba(0, 0, 0, 0.85)',
                            titleFont: { size: 14, weight: 'bold' },
                            bodyFont: { size: 13 },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: false,
                            
                            callbacks: { 
                                title: function(context) {
                                    const item = context[0];
                                    const value = item.raw.toFixed(1);
                                    const datasetLabel = item.dataset.label; // 正向/中性/負向
                                    const xLabel = item.label; // 我的狀態 / 全班平均
                                    return `${xLabel} - ${datasetLabel}：${value}%`;
                                },
                                label: function(context) {
                                    // 【關鍵修改】透過 dataIndex 判斷是學生(0) 還是 班級(1)
                                    // 從 customDetails 陣列中取出對應的那一組細項
                                    const dataIndex = context.dataIndex; 
                                    const allDetails = context.dataset.customDetails;
                                    
                                    // 防呆檢查
                                    if (!allDetails || !allDetails[dataIndex]) return '(無詳細數據)';

                                    const details = allDetails[dataIndex];
                                    const lines = [];
                                    lines.push('--------------------');

                                    if (details && details.length > 0) {
                                        details.sort((a, b) => b.percentage - a.percentage);
                                        
                                        details.forEach(d => {
                                            const p = parseFloat(d.percentage).toFixed(1);
                                            // 如果是班級平均，提示文字稍微不同
                                            const prefix = dataIndex === 1 ? '平均 ' : '';
                                            lines.push(`• ${prefix}${d.behavior_category}: ${p}%`);
                                        });
                                    } else {
                                        lines.push('(無詳細數據)');
                                    }
                                    return lines;
                                }
                            } 
                        } 
                    },
                    scales: { 
                        x: { stacked: true, max: 100, ticks: { callback: value => value + '%' } }, 
                        y: { stacked: true } 
                    },
                    layout: { padding: { top: 10, bottom: 10 } }
                }
            });
        }


    } else if (overallStatsSection) {
        overallStatsSection.innerHTML = '<h3>整體行為統計</h3><p>暫無整體行為統計數據。</p>';
    }

    // --- 步驟 4: 渲染行為趨勢圖 (散點圖) ---
    const behaviorTimelineSection = document.getElementById('behaviorTimelineSection');
    const ganttChartContainer = document.getElementById('behaviorLineChartContainer');
    const sequenceDetails = reportData.detailed_sequence_analysis;

    if (sequenceDetails && Array.isArray(sequenceDetails) && sequenceDetails.length > 0 && behaviorTimelineSection) {
        behaviorTimelineSection.style.display = 'block';
        if (ganttChartContainer && typeof Chart !== 'undefined') {
            const ganttChartData = prepareGanttChartData(sequenceDetails);
            if (ganttChartData && ganttChartData.datasets.some(ds => ds.data.length > 0)) {
                const canvas = document.createElement('canvas');
                ganttChartContainer.appendChild(canvas);
                
                ganttChartContainer.chartInstance = new Chart(canvas, {
                    type: 'scatter',
                    data: { datasets: ganttChartData.datasets },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'x', intersect: false },
                        plugins: {
                            legend: { position: 'top' },
                            // ✨✨✨【【【 這裡是最終修正的 Tooltip 邏輯 】】】✨✨✨
                            tooltip: {
                                // ✨✨✨【【【 請用這個新的 callbacks 物件，替換您現有的 callbacks 】】】✨✨✨
                                callbacks: {
                                    // 1. title: 顯示一個更明確的時間範圍
                                    title: function(tooltipItems) {
                                        if (!tooltipItems.length) return '';
                                        
                                        // 找到這個時間範圍的最小和最大時間
                                        const times = tooltipItems.map(item => item.parsed.x);
                                        const minTime = Math.min(...times);
                                        const maxTime = Math.max(...times);
                                        const toMinSec = (s) => `${Math.floor(s / 60)}分 ${Math.round(s % 60)}秒`;

                                        // 如果時間範圍很小，就只顯示一個約略時間點
                                        if (maxTime - minTime < 5) { // 5秒內視為同一個點
                                            return `時間點: 約 ${toMinSec(minTime)}`;
                                        }
                                        return `時間範圍: ${toMinSec(minTime)} ~ ${toMinSec(maxTime)}`;
                                    },
                                    
                                    // 2. beforeBody: 用來生成分隔線
                                    beforeBody: function(tooltipItems) {
                                        return '---';
                                    },
                                    
                                    // 3. label: 顯示帶有時間和分類的單行行為
                                    label: function(tooltipItem) {
                                        const dataPoint = tooltipItem.raw;
                                        const timeInSeconds = dataPoint.x;
                                        const secondsOnly = Math.round(timeInSeconds % 60);
                                        const category = tooltipItem.dataset.label; // 正向, 中性, 負向

                                        return `(${secondsOnly}秒) ${dataPoint.behavior} [${category}]`;
                                    },
                                    
                                    // 4. afterBody: 排序並添加標題
                                    afterBody: function(tooltipItems) {
                                        // Chart.js 在呼叫 afterBody 之前，已經為每個 item 呼叫了 label
                                        // 所以 tooltipItems 裡的 label 已經被我們格式化好了
                                        // 我們只需要在這裡對它們進行排序
                                        tooltipItems.sort((a, b) => a.parsed.x - b.parsed.x);
                                        
                                        // 將排序後的標籤重新映射出來
                                        const sortedLabels = tooltipItems.map(item => item.label);
                                        
                                        // 在頂部插入一個標題
                                        return ['行為序列:', ...sortedLabels];
                                    },

                                    // 5. labelColor: 禁用顏色方塊
                                    labelColor: function(tooltipItem) {
                                        return false;
                                    },
                                    
                                    // 6. labelTextColor: 根據行為分類設定文字顏色（可選，但效果很好）
                                    labelTextColor: function(tooltipItem) {
                                        const category = tooltipItem.dataset.label;
                                        if (category === '正向') return 'rgba(75, 192, 192, 1)';
                                        if (category === '負向') return 'rgba(255, 99, 132, 1)';
                                        return '#ccc'; // 中性用灰色
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                type: 'linear', position: 'bottom', min: 0,
                                title: { display: true, text: '時間 (分鐘)' },
                                ticks: { stepSize: 600, callback: value => Math.round(value / 60) }
                            },
                            y: {
                                type: 'category', labels: ganttChartData.yLabels, offset: true,
                                title: { display: true, text: '行為狀態分類' }
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
                            filenameIndex = imageIndex;
                        } else if (typeof imageIndex === 'number' && imageIndex > 0 && imageIndex <= sequence.image_filenames_in_batch.length) {
                            filenameIndex = imageIndex - 1;
                        } else {
                             console.warn("Invalid image_index_in_sequence found:", hl); return;
                        }
                        const detailItem = document.createElement('div');
                        detailItem.className = 'detail-item';
                        const imageFilename = sequence.image_filenames_in_batch[filenameIndex];
                        const imgSrc = `/api/get_sequence_image?report_file=${encodeURIComponent(reportFilename)}&image_file=${encodeURIComponent(imageFilename)}`;
                        const imgTag = `<img src="${imgSrc}" alt="${escapeHtml(imageFilename)}" class="sequence-image" loading="lazy">`;
                        let textHtml = `<div class="detail-text"><strong>${escapeHtml(imageFilename)}</strong><br>行為: ${escapeHtml(hl.behavior_category)} (信度: ${parseFloat(hl.confidence || 0).toFixed(2)})<br>`;
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
        if (specificObsContainer) {
            specificObsContainer.innerHTML = '<p>無詳細序列分析數據可顯示。</p>';
        }
    }
}

function getStandardDate(dateString, reportFilename = '') {
    // --- 備用策略優先: 直接從檔名解析，這是最可靠的 ---
    if (reportFilename) {
        const match = reportFilename.match(/_(\d{4})(\d{2})(\d{2})_/);
        if (match) {
            // match[1] 是 YYYY, match[2] 是 MM, match[3] 是 DD
            return `${match[1]}-${match[2]}-${match[3]}`;
        }
    }

    // --- 原始策略: 如果檔名解析失敗，再嘗試解析 JSON 內部時間 ---
    if (dateString && typeof dateString === 'string') {
        // 嘗試解析 '2025-11-16 14:30:00' 或 '2025-11-16'
        let match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];

        // 嘗試解析 '11/16' (MM/DD)
        match = dateString.match(/^(\d{1,2})\/(\d{1,2})/);
        if (match) {
            const year = new Date().getFullYear();
            const month = match[1].padStart(2, '0');
            const day = match[2].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    }

    console.warn("無法從以下資訊解析標準日期:", { dateString, reportFilename });
    return null; // 所有方法都失敗
}

async function populateKnowledgeHub(reportDate) {
    const hubContainer = document.getElementById('knowledgeHubContainer');
    
    if (!hubContainer) {
        console.error("Fatal Error: The container 'knowledgeHubContainer' was not found in the DOM.");
        return;
    }

    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'text-center';
    loadingMessage.style.padding = '20px';
    loadingMessage.textContent = `正在為您加載 ${reportDate} 的課堂筆記...`;
    
    hubContainer.innerHTML = '';
    hubContainer.appendChild(loadingMessage);

    try {
        const response = await fetch(`/api/student/get_note_report_for_date?date=${encodeURIComponent(reportDate)}`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => null); 
            const errorMessage = errorData?.error || `獲取筆記失敗 (HTTP ${response.status})`;
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // --- ✨✨✨ 核心修正點 ✨✨✨ ---
        // 直接從 data.knowledge_hub_content 獲取數據，這與 (6).json 的結構匹配
        const hubContentData = data.knowledge_hub_content;
        
        // 使用修正後的數據路徑進行判斷
        if (hubContentData && Array.isArray(hubContentData) && hubContentData.length > 0) {
            // 現在，正確的數據會被傳遞給渲染函數
            renderKnowledgeHubForStudent(hubContentData, hubContainer, reportDate);
        } else {
            const messageToShow = data.message || '暫無此日期的課堂筆記可供查看。';
            hubContainer.innerHTML = `<p class="text-center">${escapeHtml(messageToShow)}</p>`;
        }
    } catch (error) {
        console.error(`獲取日期 ${reportDate} 的筆記時發生錯誤:`, error);
        hubContainer.innerHTML = `<p class="error-message" style="color: red; text-align: center;">無法加載課堂筆記: ${escapeHtml(error.message)}</p>`;
    }
}

function renderKnowledgeHubForStudent(hubData, container, reportDate) {
    // 步驟 1: 清空容器，為渲染新內容做準備
    container.innerHTML = ''; 

    // 步驟 2: 檢查 reportDate 是否有效，若無則無法生成圖片路徑
    if (!reportDate) {
        console.error("renderKnowledgeHubForStudent 錯誤: 未提供 reportDate，無法生成圖片路徑。");
    }

    // 輔助函數：在前端生成一個備用的錨點ID，以防後端數據格式不符
    function createJsAnchorId(text) {
        if (typeof text !== 'string') return `topic_anchor_${Date.now()}`; // 提供一個獨特的備用ID
        // 將文字轉換為安全的、可用於HTML id 的格式
        const safeText = text.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
        return `topic_anchor_${safeText}`;
    }

    // 步驟 3: 遍歷從後端傳來的每一個主題數據
    hubData.forEach(topic => {
        // 創建每個主題卡片的基礎HTML結構
        const topicItem = document.createElement('div');
        topicItem.className = 'knowledge-topic-card';

        // 從後端數據中提取主題名稱和錨點ID
        // 這裡做了兼容性處理：即使後端傳來舊的數據格式（main_topic 是一個字串），也能正常運作
        let topicName;
        let anchorId;

        if (topic.main_topic && typeof topic.main_topic === 'object' && topic.main_topic.anchor_id) {
            // 這是新的、正確的數據格式
            topicName = topic.main_topic.name;
            anchorId = topic.main_topic.anchor_id;
        } else {
            // 這是備用邏輯，兼容舊的數據格式
            topicName = topic.main_topic;
            anchorId = createJsAnchorId(topicName);
        }

        // 創建手風琴的按鈕和面板
        const button = document.createElement('button');
        button.className = 'accordion-button';
        button.innerHTML = `<h3>${escapeHtml(topicName)}</h3><span class="accordion-icon"></span>`;
        
        const panel = document.createElement('div');
        panel.className = 'accordion-panel';
        
        // 【【【 深度連結的關鍵步驟 】】】
        // 將後端提供的 anchor_id 設置為面板 (panel) 的 HTML id 屬性
        // 這樣我們後續才能透過 document.getElementById(anchorId) 找到它
        panel.id = anchorId;

        // 用於防止重複渲染相同圖片的集合 (Set)
        const renderedImagePaths = new Set();

        // 遍歷該主題下的所有內容區塊 (文字或圖片)
        if (topic.content_blocks && Array.isArray(topic.content_blocks)) {
            topic.content_blocks.forEach(block => {
                if (block.type === 'text') {
                    // 如果是文字區塊，渲染Markdown並添加到面板中
                    const textDiv = document.createElement('div');
                    textDiv.className = 'note-text-block';
                    textDiv.innerHTML = renderSimpleMarkdown(block.content);
                    panel.appendChild(textDiv);

                } else if (block.type === 'image') {
                    // 如果是圖片區塊，進行去重檢查後再渲染
                    if (block.path && typeof block.path === 'string' && !renderedImagePaths.has(block.path)) {
                        
                        renderedImagePaths.add(block.path); // 記錄此圖片路徑，防止重複

                        // 從完整路徑中提取檔名，並構建指向後端API的URL
                        const imageName = block.path.split('\\').pop().split('/').pop();
                        const imageUrl = `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imageName)}`;
                        
                        const imageContainer = document.createElement('div');
                        imageContainer.className = 'note-image-block gallery-item';

                        const description = block.description || '相關板書快照';

                        // 創建圖片及其描述的HTML內容
                        imageContainer.innerHTML = `
                            <img src="${imageUrl}" 
                                 alt="${escapeHtml(description)}" 
                                 loading="lazy" 
                                 class="zoomable-image">
                            <p class="image-description">${escapeHtml(description)}</p>
                        `;
                        panel.appendChild(imageContainer);
                    }
                }
            });
        }
        
        // 將按鈕和面板組裝到主題卡片中，再將卡片添加到主容器
        topicItem.appendChild(button);
        topicItem.appendChild(panel);
        container.appendChild(topicItem);
        
        // 為每個按鈕綁定點擊事件，以實現手風琴的展開/收合效果
        button.addEventListener('click', function() {
            this.classList.toggle('active');
            const panelToToggle = this.nextElementSibling;
            
            // 1. 無論如何都要處理展開/收合
            if (panelToToggle.style.maxHeight) {
                panelToToggle.style.maxHeight = null;
            } else {
                panelToToggle.style.maxHeight = panelToToggle.scrollHeight + "px";
            }

            // 2. 只有在 active (展開) 時才紀錄 Log
            if (this.classList.contains('active')) {
                sendAnalyticsLog('/api/log/note_interaction', {
                    action_type: 'expand_topic',
                    target_topic: topicName,
                    report_date: reportDate 
                });
            }
        });
    });
}

window.workbookProgress = {};

function updateTopicCardUI(topicIndex) {
    const progress = window.workbookProgress[topicIndex];
    const card = document.getElementById(`mission-card-${topicIndex}`);
    const stars = document.getElementById(`stars-${topicIndex}`);
    const badge = document.getElementById(`status-badge-${topicIndex}`);
    
    if (!progress || !stars) return;

    if (progress.status === 'completed') {
        const ratio = progress.correct / progress.total;
        let starStr = '';
        if (ratio === 1) starStr = '⭐⭐⭐';      // 全對
        else if (ratio >= 0.5) starStr = '⭐⭐';   // 對一半以上
        else starStr = '⭐';                      // 雖然做完但正確率低
        
        stars.innerHTML = `<span title="正確率: ${Math.round(ratio*100)}%">${starStr}</span>`;
        badge.textContent = '✅ 已完成';
        badge.className = 'status-badge badge-green';
        card.classList.add('completed');
    }
}

function normalizeString(str) {
    if (!str) return "";
    return str
        .toLowerCase()           // 轉小寫
        .trim()                  // 移除前後空格
        .replace(/[.,!?;:]+$/, "") // 移除結尾的標點符號 (例如將 "that." 變成 "that")
        .replace(/\s+/g, " ");    // 將中間多個空格轉為單一空格
}

/**
 * 渲染 AI 練習冊頁面
 * @param {Array} workbookData - 來自 JSON 的練習題數據
 * @param {HTMLElement} container - 要渲染到的 DOM 容器
 * @param {string} reportDate - 報告日期 (YYYY-MM-DD)
 * @param {Object} historyData - 來自資料庫的歷史練習紀錄
 */
// function renderWorkbook(workbookData, container, reportDate, historyData = {}) {
//     // 0. 初始化容器與全域變數
//     container.innerHTML = ''; 
//     window.g_workbookData = workbookData; // 存入全域供後續 checkSingleAnswer 使用
//     window.workbookProgress = {}; 

//     if (!reportDate) {
//         console.error("renderWorkbook 錯誤: 未提供 reportDate，無法正確處理圖片與語音路徑。");
//     }

//     // 1. 遍歷每個練習主題 (Topic 卡片)
//     workbookData.forEach((topic, topicIndex) => {
//         const topicName = topic.main_topic;
//         const topicHistory = historyData[topicName] || []; // 取得該主題在資料庫的紀錄
//         const totalQuestions = topic.interactive_quiz ? topic.interactive_quiz.length : 0;

//         // --- 【核心邏輯：計算進度與起始索引】 ---
        
//         // 使用 Set 存儲「已完成」的題目文字，確保計算進度時不會因為重複作答而導致數字錯誤 (如 3/4)
//         const doneQuestionsSet = new Set();
//         topicHistory.forEach(h => {
//             if (h.question_text) {
//                 doneQuestionsSet.add(h.question_text.trim());
//             }
//         });

//         const uniqueDoneCount = doneQuestionsSet.size;

//         // 找出「第一個尚未完成」的題目索引 (以此作為起始顯示頁面)
//         let activeIdx = topic.interactive_quiz.findIndex(quizItem => {
//             return !doneQuestionsSet.has(quizItem.question.trim());
//         });

//         // 如果全部都做完了 (findIndex 回傳 -1)，則預設顯示最後一題
//         if (activeIdx === -1 && totalQuestions > 0) {
//             activeIdx = totalQuestions - 1; 
//         }

//         // 儲存此主題的進度狀態
//         window.workbookProgress[topicIndex] = {
//             correct: topicHistory.filter(h => h.is_correct).length,
//             total: totalQuestions,
//             status: uniqueDoneCount === 0 ? 'not_started' : (uniqueDoneCount >= totalQuestions ? 'completed' : 'in_progress'),
//             doneCount: uniqueDoneCount 
//         };

//         // --- 2. 創建主題任務卡片 HTML ---
//         const missionCard = document.createElement('div');
//         missionCard.className = 'mission-card';
//         missionCard.id = `mission-card-${topicIndex}`;
//         if (window.workbookProgress[topicIndex].status === 'completed') missionCard.classList.add('completed');

//         // 決定狀態標籤 (Badge) 的樣式與文字
//         let badgeText = '未開始';
//         let badgeClass = 'badge-gray';
//         if (window.workbookProgress[topicIndex].status === 'completed') {
//             badgeText = '✅ 已完成';
//             badgeClass = 'badge-green';
//         } else if (window.workbookProgress[topicIndex].status === 'in_progress') {
//             // 使用 uniqueDoneCount 確保顯示的是正確的題數進度
//             badgeText = `進行中 (${uniqueDoneCount}/${totalQuestions})`;
//             badgeClass = 'badge-blue';
//         }

//         const button = document.createElement('button');
//         button.className = 'accordion-button';
//         button.innerHTML = `
//             <div class="topic-info">
//                 <span class="topic-meta">練習 #${topicIndex + 1} • ${totalQuestions} 題挑戰</span>
//                 <span class="topic-title">${escapeHtml(topicName)}</span>
//             </div>
//             <div style="display:flex; align-items:center;">
//                 <span id="stars-${topicIndex}" class="star-rating"></span>
//                 <span id="status-badge-${topicIndex}" class="status-badge ${badgeClass}">${badgeText}</span>
//                 <span class="accordion-icon" style="margin-left:15px;">▼</span>
//             </div>`;
        
//         const panel = document.createElement('div');
//         panel.className = 'accordion-panel';

//         const challengeSection = document.createElement('div');
//         challengeSection.className = 'challenge-section';
        
//         // --- 3. 渲染題目清單 ---
//         if (totalQuestions > 0) {
//             topic.interactive_quiz.forEach((quizItem, quizIndex) => {
//                 const stepDiv = document.createElement('div');
//                 stepDiv.className = `quiz-step step-${topicIndex}`;
//                 stepDiv.id = `quiz-step-${topicIndex}-${quizIndex}`;
                
//                 // 【關鍵】只顯示 activeIdx 指定的題目，其餘隱藏
//                 stepDiv.style.display = (quizIndex === activeIdx) ? 'block' : 'none';

//                 // 檢查此題是否已經在資料庫中有紀錄
//                 const pastResult = topicHistory.find(h => h.question_text.trim() === quizItem.question.trim());
//                 const isAlreadyDone = !!pastResult;

//                 let questionHTML = `
//                     <div class="quiz-item" style="padding: 15px; border: 1px solid #eee; margin-bottom: 10px; border-radius: 8px; background: #fff;">
//                         <div class="quiz-header" style="display:flex; justify-content:space-between; margin-bottom:10px;">
//                             <span style="color:#4a90e2; font-weight:bold;">任務 ${quizIndex + 1} / ${totalQuestions}</span>
//                             <span style="background:#f0f0f0; padding:2px 8px; border-radius:12px; font-size:0.85em; color:#666;">${quizItem.type}</span>
//                         </div>
//                         <p class="quiz-question" style="font-size: 1.1em; font-weight: 600; margin-bottom: 15px; color:#333;">
//                             ${escapeHtml(quizItem.question)}
//                         </p>
//                 `;

//                 // 渲染提示或技巧
//                 if (quizItem.hint || quizItem.tips) {
//                     questionHTML += `<p style="color: #856404; background: #fff3cd; padding: 10px; border-radius: 5px; font-size: 0.9em; margin-bottom:15px;">💡 提示：${escapeHtml(quizItem.hint || quizItem.tips)}</p>`;
//                 }

//                 const inputName = `quiz-${topicIndex}-${quizIndex}`;
//                 const quizType = quizItem.type.toLowerCase();

//                 // --- 根據題型渲染介面 ---
//                 if (quizType === 'speaking_practice') {
//                     questionHTML += `
//                         <div class="speaking-box" style="text-align:center; padding:15px; background:#f0f8ff; border-radius:10px; border:1px solid #e1f5fe;">
//                             ${isAlreadyDone ? '<div style="color:#2e7d32; font-weight:bold; padding:10px;">✅ 語音評測已完成</div>' : `
//                                 <div style="margin-bottom:12px;">
//                                     <button type="button" class="btn-audio-ref" onclick="playWorkbookAudio(${topicIndex}, ${quizIndex}, this)">🔊 聽範例發音</button>
//                                 </div>
//                                 <div id="recorder-controls-${topicIndex}-${quizIndex}">
//                                     <button type="button" class="record-btn" onclick="startRecording(${topicIndex}, ${quizIndex})">● 錄音</button>
//                                     <button type="button" class="stop-btn" style="display:none;" onclick="stopRecording(${topicIndex}, ${quizIndex})">■ 停止</button>
//                                     <audio id="audio-player-${topicIndex}-${quizIndex}" controls style="display:none; margin:15px auto; width:100%;"></audio>
//                                     <div id="record-status-${topicIndex}-${quizIndex}" style="margin-top:8px; font-size:0.85em; color:#666;">準備好後請點擊錄音</div>
//                                 </div>
//                             `}
//                         </div>`;
//                 } else if (quizType === 'multiple_choice') {
//                     questionHTML += `<div class="options-list">`;
//                     for (let key in quizItem.options) {
//                         const optText = quizItem.options[key];
//                         // 如果已做過，根據紀錄勾選對應的 Radio
//                         const isChecked = (isAlreadyDone && pastResult.user_answer.startsWith(key)) ? 'checked' : '';
//                         questionHTML += `
//                             <label style="display:block; margin-bottom:10px; padding:8px; border:1px solid #eee; border-radius:5px;">
//                                 <input type="radio" name="${inputName}" value="${key}" ${isChecked} ${isAlreadyDone ? 'disabled' : ''}> 
//                                 <span style="margin-left:8px;">${key}: ${escapeHtml(optText)}</span>
//                             </label>`;
//                     }
//                     questionHTML += `</div>`;
//                 } else {
//                     // 填空、句子練習
//                     const userVal = isAlreadyDone ? pastResult.user_answer : '';
//                     questionHTML += `<textarea name="${inputName}" style="width:100%; height:80px; padding:10px; border:1px solid #ccc; border-radius:5px;" ${isAlreadyDone ? 'disabled' : ''} placeholder="在此輸入答案...">${escapeHtml(userVal)}</textarea>`;
//                 }

//                 // 反饋區內容 (如果是已完成的題目，預設顯示結果)
//                 questionHTML += `<div id="feedback-${topicIndex}-${quizIndex}" style="margin-top:15px; display:${isAlreadyDone ? 'block' : 'none'}">`;
//                 if (isAlreadyDone) {
//                     const isCorrect = pastResult.is_correct;
//                     if (quizType !== 'speaking_practice') {
//                         questionHTML += `
//                             <div style="padding:12px; border-radius:8px; background:${isCorrect ? '#e8f5e9' : '#ffebee'}; border:1px solid ${isCorrect ? '#c8e6c9' : '#ffcdd2'};">
//                                 <div style="color:${isCorrect ? '#2e7d32' : '#c62828'}; font-weight:bold;">${isCorrect ? '✔️ 正確' : '❌ 錯誤'}</div>
//                                 ${!isCorrect ? `<div>正確答案：<strong>${escapeHtml(quizItem.answer)}</strong></div>` : ''}
//                                 ${quizItem.explanation ? `<div style="margin-top:8px; font-size:0.9em; border-top:1px dashed #ccc; padding-top:8px;"><strong>解析：</strong>${escapeHtml(quizItem.explanation)}</div>` : ''}
//                             </div>`;
//                     } else {
//                         questionHTML += `<div style="padding:10px; background:#f1f8e9; border-radius:8px; text-align:center;">⭐ 已評分：${pastResult.score_total} 分</div>`;
//                     }
//                 }
//                 questionHTML += `</div></div>`; 

//                 // 按鈕區
//                 const actionsDiv = document.createElement('div');
//                 actionsDiv.style.marginTop = '15px';
//                 actionsDiv.innerHTML = `
//                     <button id="btn-submit-${topicIndex}-${quizIndex}" class="submit-quiz-button" 
//                         style="display:${isAlreadyDone ? 'none' : 'inline-block'};" 
//                         onclick="checkSingleAnswer(${topicIndex}, ${quizIndex}, null, ${totalQuestions})">確認答案並提交</button>
                    
//                     <button id="btn-next-${topicIndex}-${quizIndex}" class="next-quiz-button" 
//                         style="display:${isAlreadyDone ? 'inline-block' : 'none'};" 
//                         onclick="${quizIndex === totalQuestions - 1 ? `finishTopicQuiz(${topicIndex})` : `showNextQuestion(${topicIndex}, ${quizIndex})`}">
//                         ${quizIndex === totalQuestions - 1 ? '查看單元結算' : '下一題任務 ➔'}
//                     </button>
//                 `;

//                 stepDiv.innerHTML = questionHTML;
//                 stepDiv.appendChild(actionsDiv);
//                 challengeSection.appendChild(stepDiv);
//             });
//         }
//         panel.appendChild(challengeSection);

//         // --- 4. 結算畫面與複習區 ---
//         const reviewContainer = document.createElement('div');
//         reviewContainer.id = `review-container-${topicIndex}`;
//         reviewContainer.style.display = (window.workbookProgress[topicIndex].status === 'completed') ? 'block' : 'none';
//         reviewContainer.style.marginTop = '20px';
//         reviewContainer.innerHTML = `<div id="review-msg-${topicIndex}" style="text-align:center; padding:15px; background:#f9f9f9; border-radius:10px; margin-bottom:15px;">
//             <h3>單元已完成！</h3>
//             <p>正確率：${Math.round((window.workbookProgress[topicIndex].correct / totalQuestions) * 100)}%</p>
//         </div>`;

//         const reviewBtn = document.createElement('button');
//         reviewBtn.className = 'review-toggle-button';
//         reviewBtn.textContent = '📖 查看本課重點複習';
//         reviewBtn.style.width = '100%';

//         const reviewSection = document.createElement('div');
//         reviewSection.style.display = 'none';
//         reviewSection.style.marginTop = '15px';

//         if (topic.content_blocks) {
//             topic.content_blocks.forEach(block => {
//                 const text = block.content || '';
//                 const img = block.path || block.image || null;
//                 if (text) {
//                     const d = document.createElement('div');
//                     d.className = 'note-text-block';
//                     d.innerHTML = renderSimpleMarkdown(text);
//                     reviewSection.appendChild(d);
//                 }
//                 if (img) {
//                     const imgName = img.split(/[/\\]/).pop();
//                     const url = `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imgName)}`;
//                     const d = document.createElement('div');
//                     d.innerHTML = `<img src="${url}" class="zoomable-image" style="max-width:100%; margin:10px 0;"><p style="font-size:0.8em; color:#888; text-align:center;">${escapeHtml(block.description || '')}</p>`;
//                     reviewSection.appendChild(d);
//                 }
//             });
//         }

//         reviewContainer.appendChild(reviewBtn);
//         reviewContainer.appendChild(reviewSection);
//         panel.appendChild(reviewContainer);

//         // 5. 事件綁定
//         missionCard.appendChild(button);
//         missionCard.appendChild(panel);
//         container.appendChild(missionCard);

//         button.addEventListener('click', function() {
//             this.classList.toggle('active');
//             const p = this.nextElementSibling;
//             if (p.style.maxHeight) {
//                 p.style.maxHeight = null;
//             } else {
//                 p.style.maxHeight = (p.scrollHeight + 100) + "px";
//             }
//         });

//         reviewBtn.addEventListener('click', function() {
//             const isHidden = reviewSection.style.display === 'none';
//             reviewSection.style.display = isHidden ? 'block' : 'none';
//             this.textContent = isHidden ? '收合複習內容' : '📖 查看本課重點複習';
//             // 更新父層高度
//             const mPanel = this.closest('.accordion-panel');
//             if (mPanel) mPanel.style.maxHeight = (mPanel.scrollHeight + 50) + "px";
//         });

//         // 顯示星星分數
//         updateTopicCardUI(topicIndex); 
//     });
// }

/**
 * 完整修改版：解決進度重複、跳轉失敗、字串比對不準的問題
 */
function renderWorkbook(workbookData, container, reportDate, historyData = {}) {
    container.innerHTML = ''; 
    window.g_workbookData = workbookData; 
    window.workbookProgress = {}; 

    // 輔助函式：清洗題目文字，確保比對精準
    const cleanQ = (str) => {
        if (!str) return "EMPTY_QUESTION";
        return str.toString().replace(/\s+/g, '').trim();
    };

    workbookData.forEach((topic, topicIndex) => {
        const topicName = topic.main_topic;
        const topicHistory = historyData[topicName] || []; 
        const totalQuestions = topic.interactive_quiz ? topic.interactive_quiz.length : 0;

        // 1. 建立已做過題目的對照表 (Map)
        // 只要是在 topicHistory 出現過的題目，都視為「已處理」
        const finishedMap = {}; 
        topicHistory.forEach(h => {
            if (h.question_text) {
                const key = cleanQ(h.question_text);
                finishedMap[key] = h;
            }
        });

        // 2. 計算真正的不重複完成題數
        const uniqueDoneCount = Object.keys(finishedMap).length;

        // 3. 尋找「第一個還沒做過」的題目索引
        let activeIdx = topic.interactive_quiz.findIndex(quizItem => {
            const currentKey = cleanQ(quizItem.question);
            return !finishedMap[currentKey]; // 如果對照表裡沒有，就是這題了
        });

        // 如果全部做完，停在最後一題
        if (activeIdx === -1 && totalQuestions > 0) {
            activeIdx = totalQuestions - 1; 
        }

        // 儲存進度狀態
        window.workbookProgress[topicIndex] = {
            correct: Object.values(finishedMap).filter(h => h.is_correct).length,
            total: totalQuestions,
            status: uniqueDoneCount === 0 ? 'not_started' : (uniqueDoneCount >= totalQuestions ? 'completed' : 'in_progress'),
            doneCount: uniqueDoneCount 
        };

        // --- 渲染 UI 組件 ---
        const isAllCompleted = window.workbookProgress[topicIndex].status === 'completed';
        const missionCard = document.createElement('div');
        missionCard.className = `mission-card ${isAllCompleted ? 'completed' : ''}`;
        missionCard.id = `mission-card-${topicIndex}`;

        // 修正右上角 Badge 顯示邏輯
        let badgeText = '未開始';
        let badgeClass = 'badge-gray';
        if (isAllCompleted) {
            badgeText = '✅ 已完成';
            badgeClass = 'badge-green';
        } else if (uniqueDoneCount > 0) {
            badgeText = `進行中 (${uniqueDoneCount}/${totalQuestions})`;
            badgeClass = 'badge-blue';
        }

        const button = document.createElement('button');
        button.className = 'accordion-button';
        button.innerHTML = `
            <div class="topic-info">
                <span class="topic-meta">練習 #${topicIndex + 1} • ${totalQuestions} 題挑戰</span>
                <span class="topic-title">${escapeHtml(topicName)}</span>
            </div>
            <div style="display:flex; align-items:center;">
                <span id="stars-${topicIndex}" class="star-rating"></span>
                <span id="status-badge-${topicIndex}" class="status-badge ${badgeClass}">${badgeText}</span>
                <span class="accordion-icon" style="margin-left:15px;">▼</span>
            </div>`;
        
        const panel = document.createElement('div');
        panel.className = 'accordion-panel';

        const challengeSection = document.createElement('div');
        challengeSection.className = 'challenge-section';
        
        topic.interactive_quiz.forEach((quizItem, quizIndex) => {
            const stepDiv = document.createElement('div');
            stepDiv.className = `quiz-step step-${topicIndex}`;
            stepDiv.id = `quiz-step-${topicIndex}-${quizIndex}`;
            
            // 重要：決定這一題是否顯示（只顯示目前進度的 index）
            stepDiv.style.display = (quizIndex === activeIdx) ? 'block' : 'none';

            const currentKey = cleanQ(quizItem.question);
            const pastResult = finishedMap[currentKey];
            const isAlreadyDone = !!pastResult;

            let questionHTML = `
                <div class="quiz-item" style="padding: 15px; border: 1px solid #eee; margin-bottom: 10px; border-radius: 8px; background: #fff;">
                    <div class="quiz-header" style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <span style="color:#4a90e2; font-weight:bold;">任務 ${quizIndex + 1} / ${totalQuestions}</span>
                        <span style="background:#f0f0f0; padding:4px 10px; border-radius:12px; font-size:0.8em; color:#666;">${quizItem.type}</span>
                    </div>
                    <p class="quiz-question" style="font-size: 1.1em; font-weight: 600; margin-bottom: 15px; color:#333;">
                        ${escapeHtml(quizItem.question)}
                    </p>
            `;

            if (quizItem.hint || quizItem.tips) {
                questionHTML += `<p style="color: #856404; background: #fff3cd; padding: 10px; border-radius: 5px; font-size: 0.9em;">💡 提示：${escapeHtml(quizItem.hint || quizItem.tips)}</p>`;
            }

            const inputName = `quiz-${topicIndex}-${quizIndex}`;
            const quizType = quizItem.type.toLowerCase();

            // 題型 UI
            if (quizType === 'speaking_practice') {
                questionHTML += `
                    <div class="speaking-box" style="text-align:center; padding:15px; background:#f0f8ff; border-radius:10px;">
                        ${isAlreadyDone ? '<div style="color:#2e7d32; font-weight:bold;">✅ 語音評測已完成</div>' : `
                            <button type="button" class="btn-audio-ref" onclick="playWorkbookAudio(${topicIndex}, ${quizIndex}, this)">🔊 播放範例</button>
                            
                            <div id="recorder-controls-${topicIndex}-${quizIndex}" style="margin-top:10px;">
                                <!-- ✨ 關鍵修正：補上按鈕與狀態的 ID -->
                                <button type="button" class="record-btn" id="btn-record-${topicIndex}-${quizIndex}" onclick="startRecording(${topicIndex}, ${quizIndex})">● 錄音</button>
                                <button type="button" class="stop-btn" id="btn-stop-${topicIndex}-${quizIndex}" style="display:none;" onclick="stopRecording(${topicIndex}, ${quizIndex})">■ 停止</button>
                                
                                <!-- ✨ 關鍵修正：補上播放器與狀態文字的 ID -->
                                <audio id="audio-player-${topicIndex}-${quizIndex}" controls style="display:none; margin:15px auto; width:100%;"></audio>
                                <div id="record-status-${topicIndex}-${quizIndex}" style="margin-top:8px; font-size:0.85em; color:#666;">準備好後請點擊錄音</div>
                            </div>
                        `}
                    </div>`;
            } else if (quizType === 'multiple_choice') {
                questionHTML += `<div class="options-list">`;
                for (let key in quizItem.options) {
                    const optText = quizItem.options[key];
                    const isChecked = (isAlreadyDone && pastResult.user_answer && pastResult.user_answer.startsWith(key)) ? 'checked' : '';
                    questionHTML += `
                        <label style="display:block; margin-bottom:10px; padding:10px; border:1px solid #eee; border-radius:6px; background:white;">
                            <input type="radio" name="${inputName}" value="${key}" ${isChecked} ${isAlreadyDone ? 'disabled' : ''}> 
                            <span style="margin-left:8px;">${key}: ${escapeHtml(optText)}</span>
                        </label>`;
                }
                questionHTML += `</div>`;
            } else {
                const userVal = isAlreadyDone ? pastResult.user_answer : '';
                questionHTML += `<textarea name="${inputName}" style="width:100%; height:80px; padding:10px; border:1px solid #ccc; border-radius:5px;" ${isAlreadyDone ? 'disabled' : ''} placeholder="在此輸入您的答案...">${escapeHtml(userVal)}</textarea>`;
            }

            // 反饋區
            questionHTML += `<div id="feedback-${topicIndex}-${quizIndex}" style="margin-top:15px; display:${isAlreadyDone ? 'block' : 'none'}">`;
            if (isAlreadyDone) {
                const isCorrect = pastResult.is_correct;
                if (quizType !== 'speaking_practice') {
                    questionHTML += `
                        <div style="padding:12px; border-radius:8px; border:1px solid ${isCorrect ? '#c8e6c9' : '#ffcdd2'}; background:${isCorrect ? '#e8f5e9' : '#ffebee'};">
                            <div style="color:${isCorrect ? '#2e7d32' : '#c62828'}; font-weight:bold;">${isCorrect ? '✔️ 回答正確' : '❌ 答案錯誤'}</div>
                            ${!isCorrect ? `<div style="margin-top:5px;">正確答案：<strong>${escapeHtml(quizItem.answer)}</strong></div>` : ''}
                            ${quizItem.explanation ? `<div style="margin-top:8px; font-size:0.9em; border-top:1px dashed #ccc; padding-top:8px;">${escapeHtml(quizItem.explanation)}</div>` : ''}
                        </div>`;
                } else {
                    questionHTML += `<div style="padding:10px; background:#f1f8e9; border-radius:8px; text-align:center;">⭐ 成績：${pastResult.score_total} 分</div>`;
                }
            }
            questionHTML += `</div>`;

            // 按鈕
            const actionsDiv = document.createElement('div');
            actionsDiv.style.marginTop = '15px';
            actionsDiv.innerHTML = `
                <button id="btn-submit-${topicIndex}-${quizIndex}" class="submit-quiz-button" 
                    style="display:${isAlreadyDone ? 'none' : 'inline-block'};" 
                    onclick="checkSingleAnswer(${topicIndex}, ${quizIndex}, null, ${totalQuestions})">確認答案並提交</button>
                
                <button id="btn-next-${topicIndex}-${quizIndex}" class="next-quiz-button" 
                    style="display:${isAlreadyDone ? 'inline-block' : 'none'};" 
                    onclick="${quizIndex === totalQuestions - 1 ? `finishTopicQuiz(${topicIndex})` : `showNextQuestion(${topicIndex}, ${quizIndex})`}">
                    ${quizIndex === totalQuestions - 1 ? '完成單元' : '下一題任務 ➔'}
                </button>
            `;

            stepDiv.innerHTML = questionHTML;
            stepDiv.appendChild(actionsDiv);
            challengeSection.appendChild(stepDiv);
        });

        panel.appendChild(challengeSection);

        // --- 單元結算區 ---
        const reviewContainer = document.createElement('div');
        reviewContainer.id = `review-container-${topicIndex}`;
        reviewContainer.style.display = isAllCompleted ? 'block' : 'none';
        reviewContainer.style.marginTop = '20px';
        reviewContainer.innerHTML = `
            <div id="review-msg-${topicIndex}" style="text-align:center; padding:15px; background:#f9f9f9; border-radius:10px; border:1px solid #eee;">
                <h3>🎉 本單元已挑戰完成！</h3>
                <p>不重複題數正確率：${Math.round((window.workbookProgress[topicIndex].correct / totalQuestions) * 100)}%</p>
                <button class="review-toggle-button" style="margin-top:10px; width:100%;" onclick="toggleReviewSection(${topicIndex})">📖 複習本課重點筆記</button>
                <div id="review-section-${topicIndex}" style="display:none; text-align:left; margin-top:15px;"></div>
            </div>`;

        panel.appendChild(reviewContainer);
        missionCard.appendChild(button);
        missionCard.appendChild(panel);
        container.appendChild(missionCard);

        button.addEventListener('click', function() {
            this.classList.toggle('active');
            const p = this.nextElementSibling;
            p.style.maxHeight = p.style.maxHeight ? null : (p.scrollHeight + 100) + "px";
        });

        updateTopicCardUI(topicIndex); 
    });
}

// 輔助函式：切換複習區顯示
function toggleReviewSection(topicIndex) {
    const section = document.getElementById(`review-section-${topicIndex}`);
    const btn = section.previousElementSibling;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? '收合複習內容' : '📖 複習本課重點筆記';
    
    // 更新手風琴高度
    const panel = section.closest('.accordion-panel');
    if (panel) panel.style.maxHeight = (panel.scrollHeight + 50) + "px";
}



async function checkSingleAnswer(topicIndex, quizIndex, _unused, totalQuestions) {
    const quizItem = window.g_workbookData[topicIndex].interactive_quiz[quizIndex];
    const stepDiv = document.getElementById(`quiz-step-${topicIndex}-${quizIndex}`);
    const feedbackDiv = document.getElementById(`feedback-${topicIndex}-${quizIndex}`);
    const submitBtn = document.getElementById(`btn-submit-${topicIndex}-${quizIndex}`);
    const nextBtn = document.getElementById(`btn-next-${topicIndex}-${quizIndex}`);
    const topicName = window.g_workbookData[topicIndex].main_topic;
    
    if (!stepDiv || !feedbackDiv) return;

    if (window.workbookProgress[topicIndex].status === 'not_started') {
        window.workbookProgress[topicIndex].status = 'in_progress';
        updateTopicCardUI(topicIndex);
    }

    let userAnswer = '';
    let isCorrect = false;
    let userHasAnswered = false;
    const inputName = `quiz-${topicIndex}-${quizIndex}`;
    const quizType = quizItem.type ? quizItem.type.toLowerCase() : '';

    // --- A. 選擇/填空/造句 邏輯 (保持原有邏輯) ---
    if (quizType === 'multiple_choice') {
        const selectedOption = stepDiv.querySelector(`input[name="${inputName}"]:checked`);
        if (selectedOption) {
            userAnswer = selectedOption.value.trim();
            isCorrect = userAnswer.toUpperCase() === quizItem.answer.trim().toUpperCase();
            userHasAnswered = true;
        }
    } 
    else if (quizType === 'fill_in_the_blank' || quizType === 'sentence_practice') {
        const inputElement = stepDiv.querySelector(`input[name="${inputName}"], textarea[name="${inputName}"]`);
        if (inputElement && inputElement.value.trim() !== '') {
            userHasAnswered = true;
            userAnswer = inputElement.value.trim();
            isCorrect = (normalizeString(userAnswer) === normalizeString(quizItem.answer));
        }
    } 
    // --- B. 口說練習邏輯 (視覺大改版 - 對齊圖二) ---
    else if (quizType === 'speaking_practice') {
        const key = `${topicIndex}-${quizIndex}`;
        const hasRecording = window.audioChunks[key] && window.audioChunks[key].finalBlob;

        if (hasRecording) {
            submitBtn.textContent = "AI 評分中...";
            submitBtn.disabled = true;

            try {
                const dateStr = window.currentReportDateStr || new Date().toISOString().split('T')[0]; 
                const uploadResult = await uploadAudio(topicIndex, quizIndex, dateStr);
                
                if (uploadResult.success) {
                    userHasAnswered = true;
                    isCorrect = true; 
                    const analysis = uploadResult.analysis;

                    // 1. 更新錄音控制區的狀態 (圖二上半部：藍色背景區)
                    const controlBox = document.getElementById(`recorder-controls-${topicIndex}-${quizIndex}`);
                    if(controlBox) {
                        controlBox.innerHTML = `
                            <div style="background: #eef7ff; border-radius: 12px; padding: 20px; display: flex; align-items: center; justify-content: center; gap: 20px; border: 1px solid #d0e8ff;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span style="font-size: 1.5em;">👤</span>
                                    <span style="color: #0056b3; font-weight: bold; font-size: 1.1em;">${escapeHtml(quizItem.reference_sentence || quizItem.answer)}</span>
                                </div>
                                <audio src="${URL.createObjectURL(window.audioChunks[key].finalBlob)}" controls style="height: 35px;"></audio>
                                <div style="display: flex; gap: 10px;">
                                    <span style="background: white; border: 1px solid #b2d7ff; color: #2e7d32; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: bold;">✔️ 已錄製</span>
                                    <span style="background: white; border: 1px solid #b2d7ff; color: #2e7d32; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: bold;">✔️ 已評分完成</span>
                                </div>
                            </div>
                        `;
                    }

                    // 2. 生成詳細評分卡片 (圖二下半部：灰色背景區)
                    if (analysis) {
                        const weakWords = analysis.word_analysis.filter(w => w.status === 'wrong' || w.status === 'weak');
                        const missingWords = analysis.word_analysis.filter(w => w.status === 'missing');

                        const weakHTML = weakWords.length > 0 
                            ? weakWords.map(w => `<span class="word-pill-blue">${escapeHtml(w.word)}</span>`).join('')
                            : `<span style="color:#666;">(無，發音很棒！)</span>`;

                        const missingHTML = missingWords.length > 0
                            ? missingWords.map(w => `<span class="word-pill-grey">${escapeHtml(w.word)}</span>`).join('')
                            : `<span style="color:#666;">(無，都有唸到！)</span>`;

                        feedbackDiv.innerHTML = `
                            <style>
                                .ai-report-card { background: #f0f0f0; border-radius: 15px; padding: 30px; margin-top: 20px; font-family: sans-serif; position: relative; }
                                .score-bubble-container { display: flex; justify-content: center; gap: 30px; background: #d9d9d9; border-radius: 15px; padding: 25px; margin-bottom: 25px; }
                                .score-item { text-align: center; }
                                .score-label { font-size: 0.85em; color: #555; margin-bottom: 8px; }
                                .score-circle { width: 65px; height: 65px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.4em; font-weight: bold; border: 2px solid rgba(0,0,0,0.05); }
                                .bg-yellow { background: #fff176; color: #333; }
                                .bg-red { background: #ff8a80; color: white; }
                                .word-pill-blue { background: #82b1ff; color: #002d72; padding: 6px 15px; border-radius: 20px; display: inline-block; margin: 4px; font-weight: bold; font-size: 0.9em; }
                                .word-pill-grey { background: #bdbdbd; color: #333; padding: 6px 15px; border-radius: 20px; display: inline-block; margin: 4px; font-weight: bold; font-size: 0.9em; }
                                .section-title { font-size: 0.9em; color: #444; margin: 15px 0 8px 0; font-weight: bold; }
                                .summary-footer-bar { background: #ffcdd2; color: #b71c1c; padding: 15px; border-radius: 0 0 15px 15px; margin: 25px -30px -30px -30px; text-align: center; font-weight: bold; }
                            </style>
                            <div class="ai-report-card">
                                <div class="score-bubble-container">
                                    <div class="score-item"><div class="score-label">發音</div><div class="score-circle bg-yellow">${analysis.pronunciation_score}</div></div>
                                    <div class="score-item"><div class="score-label">流利度</div><div class="score-circle bg-yellow">${analysis.fluency_score}</div></div>
                                    <div class="score-item"><div class="score-label">準確度</div><div class="score-circle bg-yellow">${analysis.accuracy_score}</div></div>
                                    <div class="score-item"><div class="score-label">總分</div><div class="score-circle bg-red">${analysis.total_score}</div></div>
                                </div>
                                <div style="text-align: center;">
                                    <div class="section-title">發音需更加強的單字：</div>
                                    <div>${weakHTML}</div>
                                    <div class="section-title">沒唸到或唸錯的單字：</div>
                                    <div>${missingHTML}</div>
                                </div>
                                <div class="summary-footer-bar">${escapeHtml(analysis.feedback_summary || "做得不錯！")}</div>
                                <div style="margin-top: 20px; text-align: center;">
                                    <button type="button" onclick="retrySpeakingPractice(${topicIndex}, ${quizIndex})" 
                                            style="background: #607d8b; color: white; border: none; padding: 8px 20px; border-radius: 20px; cursor: pointer; font-size: 0.9em;">
                                        🔄 重新挑戰 (第 ${window.quizAttempts[key] || 1} 次)
                                    </button>
                                </div>
                            </div>
                        `;
                        feedbackDiv.style.display = 'block';
                    }
                } else {
                    alert("上傳失敗: " + uploadResult.message);
                    submitBtn.textContent = "確認答案並提交";
                    submitBtn.disabled = false;
                    return;
                }
            } catch (e) {
                console.error(e);
                alert("伺服器評分發生錯誤。");
                submitBtn.textContent = "確認答案並提交";
                submitBtn.disabled = false;
                return;
            }
        } else {
            alert("請先錄製您的聲音再提交哦！");
            return;
        }
    }

    // --- C. 通用結尾處理 (按鈕切換、進度累加) ---
    if (!userHasAnswered) {
        alert("請先完成作答後再提交哦！");
        return;
    }

    if (isCorrect) window.workbookProgress[topicIndex].correct++;
    
    const inputs = stepDiv.querySelectorAll('input, textarea, radio');
    inputs.forEach(input => input.disabled = true);
    
    submitBtn.style.display = 'none';
    nextBtn.style.display = 'inline-block';

    if (quizType !== 'speaking_practice') {
        feedbackDiv.innerHTML = `
            <div style="padding:15px; border-radius:8px; border:1px solid ${isCorrect ? '#c3e6cb' : '#f5c6cb'}; background:${isCorrect ? '#d4edda' : '#f8d7da'}; color:${isCorrect ? '#155724' : '#721c24'};">
                <div style="font-weight:bold; margin-bottom:5px;">${isCorrect ? '✔️ 回答正確！' : '❌ 答案不完全正確'}</div>
                ${!isCorrect ? `<div>正確答案是：<strong>${escapeHtml(quizItem.answer)}</strong></div>` : ''}
                ${quizItem.explanation ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(0,0,0,0.1); font-size:0.9em;"><strong>解析：</strong>${escapeHtml(quizItem.explanation)}</div>` : ''}
            </div>`;
        feedbackDiv.style.display = 'block';

        sendAnalyticsLog('/api/log_quiz_attempt', [{
            report_date: window.currentReportDateStr,
            topic_name: topicName,
            question_text: quizItem.question,
            question_type: quizType,
            user_answer: userAnswer,
            is_correct: isCorrect
        }]);
    }
    
    // 更新手風琴高度
    const panel = stepDiv.closest('.accordion-panel');
    if (panel) panel.style.maxHeight = panel.scrollHeight + "px";
}

/**
 * 切換到下一題
 */
function showNextQuestion(topicIndex, currentQuizIndex) {
    const currentStep = document.getElementById(`quiz-step-${topicIndex}-${currentQuizIndex}`);
    const nextStep = document.getElementById(`quiz-step-${topicIndex}-${currentQuizIndex + 1}`);
    const progressText = document.getElementById(`progress-text-${topicIndex}`);
    
    if (currentStep && nextStep) {
        // 淡出當前題目 (用簡單的 display 切換即可，動畫會讓程式碼變複雜)
        currentStep.style.display = 'none';
        
        // 顯示下一題
        nextStep.style.display = 'block';
        
        // 更新進度文字
        // 我們需要知道總題數，可以從 DOM 或全域變數算，這裡簡單處理：
        // 假設 progressText 的內容是 "1 / 3"，我們解析它
        if (progressText) {
            const total = progressText.textContent.split('/')[1].trim();
            progressText.textContent = `${currentQuizIndex + 2} / ${total}`;
        }

        // 重新計算手風琴高度
        const panel = nextStep.closest('.accordion-panel');
        if (panel && panel.style.maxHeight) {
            panel.style.maxHeight = panel.scrollHeight + "px";
        }
    }
}

function finishTopicQuiz(topicIndex) {
    const progress = window.workbookProgress[topicIndex];
    progress.status = 'completed';
    updateTopicCardUI(topicIndex);

    const reviewContainer = document.getElementById(`review-container-${topicIndex}`);
    const reviewMsg = document.getElementById(`review-msg-${topicIndex}`);
    
    // 取得當前單元的所有題目與學生的表現
    const topicName = window.g_workbookData[topicIndex].main_topic;
    // 這裡建議在 checkSingleAnswer 時同步更新一個 localSessionResults 陣列
    // 或者直接從 UI 上的 feedback-area 內容抓取
    
    const percentage = Math.round((progress.correct / progress.total) * 100);
    
    let detailHTML = `<div style="text-align:left; margin-top:10px; font-size:0.9em;">`;
    // 這裡可以根據你存的 doneQuestions 顯示每一題的狀態
    detailHTML += `<strong>單元總結：</strong> 得分 ${percentage}%<br>`;
    detailHTML += `正確題數：${progress.correct} / ${progress.total}</div>`;

    reviewMsg.innerHTML = `<h3>${percentage >= 60 ? '🎉 任務完成！' : '💪 繼續努力！'}</h3> ${detailHTML}`;
    reviewContainer.style.display = 'block';

    const panel = reviewContainer.closest('.accordion-panel');
    if (panel) panel.style.maxHeight = panel.scrollHeight + "px";
}

async function populateWorkbook(reportDate) {
    const workbookContainer = document.getElementById('workbookContainer');
    workbookContainer.innerHTML = `<p>正在同步您的學習進度...</p>`;

    try {
        // 1. 同時抓取題目 JSON 和 資料庫歷史紀錄
        const [respWorkbook, respHistory] = await Promise.all([
            fetch(`/api/student/get_workbook_report_for_date?date=${encodeURIComponent(reportDate)}`),
            fetch(`/api/student/get_quiz_history?date=${encodeURIComponent(reportDate)}`)
        ]);

        const workbookDataRaw = await respWorkbook.json();
        const historyData = await respHistory.json(); // 這是從 DB 來的舊進度

        const workbookData = workbookDataRaw.workbook_data?.refined_knowledge_hub;
        
        if (workbookData) {
            // 2. 呼叫渲染函數，並傳入 historyData
            renderWorkbook(workbookData, workbookContainer, reportDate, historyData);
        }
    } catch (error) {
        console.error(error);
    }
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
    document.addEventListener('click', function(event) {
        // 【關鍵修改】
        // 使用 .closest() 來查找被點擊的元素或其父元素中，是否包含 .zoomable-image
        // 這比 event.target 更可靠，因為用戶可能點到圖片的邊框或容器
        const clickedImage = event.target.closest('.zoomable-image');

        // 只有當 clickedImage 存在 (即點擊發生在可縮放圖片上或其內部) 時，才執行後續操作
        if (clickedImage) {
            
            // 記錄點擊事件
            logStudentActivity('click', `zoom_image_${clickedImage.alt}`);

            // 設置 Modal 內容並顯示
            modalImg.src = clickedImage.src;
            captionText.textContent = clickedImage.alt; // 使用 alt 作為標題
            modal.style.display = "block";

            sendAnalyticsLog('/api/log/note_interaction', {
                action_type: 'zoom_image',
                target_topic: clickedImage.alt, // 圖片描述
                report_date: window.currentReportDateStr
            });
        }
    });

    // --- 關閉 Modal 的邏輯 (這部分不變) ---
    closeBtn.onclick = function() { 
        modal.style.display = "none";
    }
    modal.onclick = function(event) {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    }
}

// 頁面卸載時記錄最後一個標籤頁的停留時間
window.addEventListener('beforeunload', function (e) {
    if (currentOpenTabId && currentTabStartTime) {
        const endTime = new Date();
        const durationSec = Math.round((endTime - currentTabStartTime) / 1000);

        const payload = {
            page_name: currentOpenTabId,
            report_date: window.currentReportDateStr || "none",
            duration: durationSec
        };
        
        if (navigator.sendBeacon) {
            // 指向新的 analytics 專用 beacon 路由（建議後端也要準備好接收這個格式）
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon('/api/log/page_access', blob); 
        }
    }
});

function renderSimpleMarkdown(markdownText) {
    // 防呆：如果傳入的不是字串 (例如 null 或 undefined)，直接回傳空字串
    if (typeof markdownText !== 'string') {
        return '';
    }

    // 內建一個安全的 HTML 轉義函數
    function escapeContent(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // 統一換行符號
    const lines = markdownText.replace(/\\n/g, '\n').split('\n');
    let htmlOutput = '';
    let inList = false;

    lines.forEach(line => {
        const trimmedLine = line.trim();

        if (!trimmedLine.startsWith('-') && inList) {
            htmlOutput += '</ul>';
            inList = false;
        }

        if (trimmedLine.startsWith('## ')) {
            htmlOutput += `<h3>${escapeContent(trimmedLine.substring(3))}</h3>`;
        } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
            const content = trimmedLine.substring(2, trimmedLine.length - 2);
            htmlOutput += `<h4><strong>${escapeContent(content)}</strong></h4>`;
        } else if (trimmedLine.startsWith('- ')) {
            if (!inList) {
                htmlOutput += '<ul>';
                inList = true;
            }
            // 處理粗體
            const listItemContent = escapeContent(trimmedLine.substring(2))
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlOutput += `<li>${listItemContent}</li>`;
        } else if (trimmedLine === '') {
            if (!inList) htmlOutput += '<br>';
        } else {
            // 一般段落
            const paragraphContent = escapeContent(trimmedLine)
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlOutput += `<p>${paragraphContent}</p>`;
        }
    });

    if (inList) {
        htmlOutput += '</ul>';
    }

    return htmlOutput;
}

async function jumpToTopic(filename, targetTabId, anchorId) {
    // 步驟 1: 呼叫 loadAndDisplayReport 載入新的報告數據
    // 我們傳入一個回呼函式 (callback)，它會在報告載入並渲染完成後被執行
    await window.loadAndDisplayReport(filename, () => {
        // 步驟 2: 報告已載入完成，現在切換到 "AI課堂筆記" 頁籤
        // 我們直接呼叫 openTab，並傳入 null 作為事件物件
        openTab(null, targetTabId);

        // 步驟 3: 找到目標主題並展開它
        setTimeout(() => { // 使用 setTimeout 確保頁籤切換的動畫效果完成
            const elementToExpand = document.getElementById(anchorId);
            if (elementToExpand) {
                // 找到它的按鈕
                const button = elementToExpand.previousElementSibling;
                // 如果它尚未展開，就模擬一次點擊
                if (button && !button.classList.contains('active')) {
                    button.click();
                }
                // 將該主題滾動到畫面中央，提升使用者體驗
                elementToExpand.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100); // 延遲 100 毫秒
    });
}

// async function populateRelatedTopicsIndex() {
//     const container = document.getElementById('relatedTopicsContainer');
//     if (!container) {
//         console.error("錯誤：找不到主題索引容器 'relatedTopicsContainer'。");
//         return;
//     }

//     try {
//         // 1. 呼叫我們在後端新增的全新 API
//         const response = await fetch('/api/student/all_notes_index');
//         if (!response.ok) {
//             throw new Error('無法從伺服器獲取主題索引');
//         }
//         const allNotesIndex = await response.json();

//         // 2. 檢查是否有返回數據
//         if (allNotesIndex && Array.isArray(allNotesIndex) && allNotesIndex.length > 0) {
//             let htmlContent = '<div class="related-topics-accordion">';
            
//             allNotesIndex.forEach(note => {
//                 const filenameParam = `'${escapeHtml(note.behavior_report_filename)}'`;
//                 const tabIdParam = `'knowledgeHubTab'`; // 我們要跳轉的目標頁籤 ID

//                 htmlContent += `
//                     <button class="accordion-button">
//                         ${escapeHtml(note.display_name)}
//                     </button>
//                     <div class="accordion-panel">
//                         <ul>
//                             ${note.topics.map(topic => {
//                                 // 【【【 核心修改點在這裡 】】】
//                                 // 為每個主題連結綁定新的點擊事件，傳入三個參數
//                                 const anchorIdParam = `'${escapeHtml(topic.anchor_id)}'`;
//                                 return `
//                                     <li>
//                                         <a href="#" onclick="event.preventDefault(); jumpToTopic(${filenameParam}, ${tabIdParam}, ${anchorIdParam})">
//                                             ${escapeHtml(topic.name)}
//                                         </a>
//                                     </li>
//                                 `;
//                             }).join('')}
//                         </ul>
//                     </div>
//                 `;
//             });

//             htmlContent += '</div>';
//             container.innerHTML = htmlContent;

//             // 4. 為新生成的手風琴按鈕添加展開/收合的事件監聽
//             container.querySelectorAll('.accordion-button').forEach(button => {
//                 button.addEventListener('click', function(event) {
//                     // 只有在點擊按鈕本身（而不是裡面的連結）時才觸發開合
//                     this.classList.toggle('active');
//                     const panel = this.nextElementSibling;
//                     if (panel.style.maxHeight) {
//                         panel.style.maxHeight = null;
//                     } else {
//                         panel.style.maxHeight = panel.scrollHeight + "px";
//                     }
//                 });
//             });

//         } else {
//             container.innerHTML = '<p>暫無其他課程主題可顯示。</p>';
//         }
//     } catch (error) {
//         console.error('加載相關主題索引失敗:', error);
//         container.innerHTML = '<p style="color:red;">加載主題索引時發生錯誤，請稍後再試。</p>';
//     }
// }

// student_report.js

// async function populateRelatedTopicsIndex() {
//     const container = document.getElementById('relatedTopicsContainer');
//     if (!container) {
//         console.error("錯誤：找不到主題索引容器 'relatedTopicsContainer'。");
//         return;
//     }

//     try {
//         const response = await fetch('/api/student/all_notes_index');
//         if (!response.ok) {
//             throw new Error('無法從伺服器獲取主題索引');
//         }
        
//         const allNotesIndex = await response.json();

//         if (allNotesIndex && Array.isArray(allNotesIndex) && allNotesIndex.length > 0) {
//             let htmlContent = '<div class="related-topics-accordion">';
            
//             allNotesIndex.forEach(note => {
//                 // 【【【 關鍵檢查點 1 】】】
//                 // 確保從後端拿到的 behavior_report_filename 是有效的
//                 if (!note.behavior_report_filename) {
//                     console.warn('索引數據中缺少 behavior_report_filename:', note);
//                     return; // 跳過這一筆不完整的數據
//                 }

//                 const filenameParam = `'${escapeHtml(note.behavior_report_filename)}'`;
//                 const tabIdParam = `'knowledgeHubTab'`;
                
//                 htmlContent += `
//                     <button class="accordion-button">
//                         ${escapeHtml(note.display_name)}
//                     </button>
//                     <div class="accordion-panel">
//                         <ul>
//                             ${note.topics.map(topic => {
//                                 // 【【【 關鍵檢查點 2 】】】
//                                 // 確保 topic 物件是有效的
//                                 if (!topic || !topic.anchor_id || !topic.name) {
//                                     return ''; // 如果主題數據不完整，則不生成此連結
//                                 }
//                                 const anchorIdParam = `'${escapeHtml(topic.anchor_id)}'`;
//                                 return `
//                                     <li>
//                                         <a href="#" onclick="event.preventDefault(); jumpToTopic(${filenameParam}, ${tabIdParam}, ${anchorIdParam})">
//                                             ${escapeHtml(topic.name)}
//                                         </a>
//                                     </li>
//                                 `;
//                             }).join('')}
//                         </ul>
//                     </div>
//                 `;
//             });

//             htmlContent += '</div>';
//             container.innerHTML = htmlContent;

//             // 事件監聽邏輯保持不變
//             container.querySelectorAll('.accordion-button').forEach(button => {
//                 button.addEventListener('click', function(event) {
//                     this.classList.toggle('active');
//                     const panel = this.nextElementSibling;
//                     if (panel.style.maxHeight) {
//                         panel.style.maxHeight = null;
//                     } else {
//                         panel.style.maxHeight = panel.scrollHeight + "px";
//                     }
//                 });
//             });

//         } else {
//             container.innerHTML = '<p>暫無其他課程主題可顯示。</p>';
//         }
//     } catch (error) {
//         console.error('加載相關主題索引失敗:', error);
//         container.innerHTML = '<p style="color:red;">加載主題索引時發生錯誤，請稍後再試。</p>';
//     }
// }

async function populateRelatedTopicsIndex() {
    const container = document.getElementById('relatedTopicsContainer');
    if (!container) {
        console.error("錯誤：找不到主題索引容器 'relatedTopicsContainer'。");
        return;
    }

    try {
        const response = await fetch('/api/student/all_notes_index');
        if (!response.ok) {
            throw new Error('無法從伺服器獲取主題索引');
        }
        
        const allNotesIndex = await response.json();

        if (allNotesIndex && Array.isArray(allNotesIndex) && allNotesIndex.length > 0) {
            // 【【【 核心修改開始 】】】
            // 我們不再拼接手風琴的 HTML，而是直接生成標題和列表
            
            let htmlContent = '<div class="topics-index-list">'; // 使用一個新的容器 class
            
            allNotesIndex.forEach(note => {
                // 確保 behavior_report_filename 存在
                if (!note.behavior_report_filename) {
                    console.warn('索引數據中缺少 behavior_report_filename:', note);
                    return; // 跳過此筆數據
                }

                const filenameParam = `'${escapeHtml(note.behavior_report_filename)}'`;
                const tabIdParam = `'knowledgeHubTab'`;
                
                // 1. 生成日期標題 (使用 h4 標籤)
                htmlContent += `<h4 class="topic-date-heading">${escapeHtml(note.display_name)}</h4>`;
                
                // 2. 生成該日期下的主題列表 (使用 ul 和 li 標籤)
                if (note.topics && note.topics.length > 0) {
                    htmlContent += `<ul class="topic-list">`;
                    htmlContent += note.topics.map(topic => {
                        if (!topic || !topic.anchor_id || !topic.name) return '';
                        
                        const anchorIdParam = `'${escapeHtml(topic.anchor_id)}'`;
                        return `
                            <li>
                                <a href="#" onclick="event.preventDefault(); jumpToTopic(${filenameParam}, ${tabIdParam}, ${anchorIdParam})">
                                    ${escapeHtml(topic.name)}
                                </a>
                            </li>
                        `;
                    }).join('');
                    htmlContent += `</ul>`;
                }
            });

            htmlContent += '</div>';
            container.innerHTML = htmlContent;
            
            // 【【【 核心修改結束 】】】
            // 因為不再有手風琴按鈕，所以我們需要刪除舊的事件監聽器綁定程式碼。
            // 原本的 container.querySelectorAll('.accordion-button').forEach(...) 整段都已移除。

        } else {
            container.innerHTML = '<p>暫無其他課程主題可顯示。</p>';
        }
    } catch (error) {
        console.error('加載相關主題索引失敗:', error);
        container.innerHTML = '<p style="color:red;">加載主題索引時發生錯誤，請稍後再試。</p>';
    }
}

window.audioRecorders = {};
window.audioChunks = {};

window.quizAttempts = {};

/**
 * 開始錄音
 */
async function startRecording(topicIndex, quizIndex) {
    const recordBtn = document.getElementById(`btn-record-${topicIndex}-${quizIndex}`);
    const stopBtn = document.getElementById(`btn-stop-${topicIndex}-${quizIndex}`);
    const statusSpan = document.getElementById(`record-status-${topicIndex}-${quizIndex}`);
    const audioPlayer = document.getElementById(`audio-player-${topicIndex}-${quizIndex}`);
    const submitBtn = document.getElementById(`btn-submit-${topicIndex}-${quizIndex}`); // 下方的確認按鈕

    // 檢查瀏覽器支援
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("您的瀏覽器不支援錄音功能，請使用 Chrome 或 Edge。");
        return;
    }

    try {
        // 1. 請求麥克風權限
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // 2. 建立 MediaRecorder
        const mediaRecorder = new MediaRecorder(stream);
        const key = `${topicIndex}-${quizIndex}`;
        
        window.audioRecorders[key] = mediaRecorder;
        window.audioChunks[key] = [];

        // 3. 收集音訊數據
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                window.audioChunks[key].push(event.data);
            }
        };

        // 4. 錄音結束後的處理
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(window.audioChunks[key], { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // 設定播放器
            audioPlayer.src = audioUrl;
            audioPlayer.style.display = 'block';

            const panel = audioPlayer.closest('.accordion-panel');
            if (panel) {
                // 重新設定高度為 scrollHeight，確保播放器與下方的確認按鈕都能顯現
                panel.style.maxHeight = panel.scrollHeight + "px";
            }
            
            // 暫存 Blob 以便稍後上傳 (掛載到 DOM 元素上，方便上傳函式讀取)
            audioPlayer.dataset.blobUrl = audioUrl; 
            // 注意：我們不能直接把 blob 存在 DOM dataset，這裡我們用全域變數存 blob
            window.audioChunks[key].finalBlob = audioBlob;

            // 關閉麥克風串流 (紅燈熄滅)
            stream.getTracks().forEach(track => track.stop());

            statusSpan.textContent = "已錄製";
            statusSpan.style.color = "green";
            
            // 恢復按鈕狀態
            recordBtn.style.display = 'inline-flex';
            recordBtn.innerHTML = '<span style="font-size: 1.2em; margin-right: 5px;">↺</span> 重錄';
            stopBtn.style.display = 'none';
        };

        // 5. 開始錄製
        mediaRecorder.start();

        // 6. 更新 UI
        recordBtn.style.display = 'none';
        stopBtn.style.display = 'inline-flex';
        audioPlayer.style.display = 'none'; // 錄音時隱藏播放器
        statusSpan.textContent = "錄音中...";
        statusSpan.style.color = "red";
        
        // 錄音期間禁止提交
        if(submitBtn) submitBtn.disabled = true;

    } catch (err) {
        console.error("錄音啟動失敗:", err);
        alert("無法啟動錄音，請確認您已允許麥克風權限。");
    }
}

/**
 * 停止錄音
 */
function stopRecording(topicIndex, quizIndex) {
    const key = `${topicIndex}-${quizIndex}`;
    const recorder = window.audioRecorders[key];
    const submitBtn = document.getElementById(`btn-submit-${topicIndex}-${quizIndex}`);

    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        if(submitBtn) submitBtn.disabled = false; // 恢復提交按鈕
    }
}


async function uploadAudio(topicIndex, quizIndex, reportDate) {
    const key = `${topicIndex}-${quizIndex}`;
    const audioBlob = window.audioChunks[key]?.finalBlob;
    if (!audioBlob) return { success: false, message: "找不到錄音檔" };

    const fullTopicName = window.g_workbookData[topicIndex].main_topic; // 取得完整標題

    const formData = new FormData();
    formData.append('topic_name', fullTopicName);
    formData.append('audio_data', audioBlob, 'recording.webm');
    formData.append('date', reportDate);
    formData.append('topic_index', topicIndex);
    formData.append('quiz_index', quizIndex);
    formData.append('topic_name', fullTopicName); // 【關鍵】傳送完整標題給後端
    const quizItem = window.g_workbookData[topicIndex].interactive_quiz[quizIndex];
    formData.append('question_text', quizItem.question); // 傳送題目文字
    formData.append('reference_sentence', quizItem.reference_sentence || quizItem.answer);
    formData.append('attempt', window.quizAttempts[key] || 1);

    const response = await fetch('/api/student/upload_voice_record', { method: 'POST', body: formData });
    return await response.json();
}

/**
 * 播放練習題的範例語音 (TTS) - 支援快取版
 */
async function playWorkbookAudio(topicIndex, quizIndex, btnElement) {

    sendAnalyticsLog('/api/log/note_interaction', {
        action_type: 'play_audio_ref',
        target_topic: `Topic_${topicIndex}_Quiz_${quizIndex}`,
        report_date: window.currentReportDateStr
    });
    
    if (!window.g_workbookData || !window.g_workbookData[topicIndex]) return;
    
    const quizItem = window.g_workbookData[topicIndex].interactive_quiz[quizIndex];
    const textToRead = quizItem.reference_sentence || quizItem.answer;

    // 獲取當前報告的日期 (從全域變數)
    // 假設 loadAndDisplayReport 已經設定了 window.currentReportDateStr (例如 "2025-09-28")
    const reportDate = window.currentReportDateStr || "";

    if (!textToRead) {
        alert("沒有可播放的範例文字。");
        return;
    }

    const originalText = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = '⏳ 載入中...';
    btnElement.style.opacity = '0.7';

    try {
        const response = await fetch('/api/generate_tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            // 【修改點】這裡加入 date, topic_index, quiz_index
            body: JSON.stringify({ 
                text: textToRead,
                date: reportDate,
                topic_index: topicIndex,
                quiz_index: quizIndex
            })
        });

        if (!response.ok) {
            throw new Error('語音生成失敗');
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.play();
        btnElement.innerHTML = '🔊 播放中...';

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            btnElement.disabled = false;
            btnElement.innerHTML = originalText;
            btnElement.style.opacity = '1';
        };
        
        audio.onerror = () => { throw new Error('播放錯誤'); };

    } catch (error) {
        console.error('TTS Error:', error);
        alert('無法播放範例音訊，請稍後再試。');
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
        btnElement.style.opacity = '1';
    }
}

function retrySpeakingPractice(topicIndex, quizIndex) {
    const key = `${topicIndex}-${quizIndex}`;
    
    // 1. 增加嘗試次數
    if (!window.quizAttempts[key]) window.quizAttempts[key] = 1;
    window.quizAttempts[key]++;

    // 2. 重置錄音相關變數
    // 清空舊的錄音檔，強制使用者重新錄製
    if (window.audioChunks[key]) {
        window.audioChunks[key].finalBlob = null;
        window.audioChunks[key] = [];
    }

    // 3. UI 重置
    const feedbackDiv = document.getElementById(`feedback-${topicIndex}-${quizIndex}`);
    const controlBox = document.getElementById(`recorder-controls-${topicIndex}-${quizIndex}`);
    const submitBtn = document.getElementById(`btn-submit-${topicIndex}-${quizIndex}`);
    const recordBtn = document.getElementById(`btn-record-${topicIndex}-${quizIndex}`);
    const stopBtn = document.getElementById(`btn-stop-${topicIndex}-${quizIndex}`);
    const audioPlayer = document.getElementById(`audio-player-${topicIndex}-${quizIndex}`);
    const statusSpan = document.getElementById(`record-status-${topicIndex}-${quizIndex}`);

    // 隱藏分數卡
    if (feedbackDiv) {
        feedbackDiv.style.display = 'none';
        feedbackDiv.innerHTML = '';
    }

    // 顯示錄音控制區
    if (controlBox) {
        controlBox.style.display = 'flex';
    }

    // 重置錄音按鈕狀態
    if (recordBtn) {
        recordBtn.style.display = 'inline-flex';
        recordBtn.innerHTML = '<span style="font-size: 1.2em; margin-right: 5px;">●</span> 錄音';
    }
    if (stopBtn) stopBtn.style.display = 'none';
    
    // 重置播放器和狀態文字
    if (audioPlayer) {
        audioPlayer.style.display = 'none';
        audioPlayer.src = '';
    }
    if (statusSpan) {
        statusSpan.textContent = '未開始';
        statusSpan.style.color = '#666';
    }

    // 恢復提交按鈕
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.display = 'inline-block'; // 確保按鈕可見
        submitBtn.textContent = '確認答案'; // 恢復原始文字
    }

    // 如果有下一題按鈕，先隱藏
    const nextBtn = document.getElementById(`btn-next-${topicIndex}-${quizIndex}`);
    if (nextBtn) {
        nextBtn.style.display = 'none';
    }

    console.log(`已重置題目 ${key}，準備進行第 ${window.quizAttempts[key]} 次錄音`);
}


function logNoteSearch(query) {
    fetch('/api/log/note_interaction', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            action_type: 'search',
            search_query: query,
            report_date: window.currentReportDateStr // 紀錄是在看哪天的報告時搜尋的
        })
    });
}
function sendAnalyticsLog(endpoint, payload) {
    if (!current_user_is_authenticated_in_js) return;

    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => console.error("Analytics Error:", err));
}
// 範例：紀錄知識點展開
// 在你的按鈕監聽器內加入：
// logNoteInteraction('expand', topicName);