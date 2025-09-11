// static/js/teacher_dashboard.js (全新版本)

// --- 全局變量 ---
let allStudentData = []; // 用於緩存從API獲取的所有學生數據
let taggingSessionData = [];
let behaviorChartInstance = null;
let taggedImageIdentifiers = new Set();
const BATCH_SIZE = 50;

const ALL_BEHAVIOR_CATEGORIES = [
    "主動舉手",
    "被動舉手",
    "做筆記",
    "坐姿直立",
    "托腮",
    "觸摸臉部",
    "觸摸頭髮",
    "翻書",
    "目視他處",
    "目視同學",
    "目視教師",
    "目視書本/筆記",
    "目視黑板",
    "觸摸臉部",
    "觸摸頭髮",
    "坐姿直立",
    "身體前傾",
    "身體後靠",
    "低頭(非學習)",
    "趴睡",
    "喝水",
    "飲食",
    "玩弄手部/文具",
    "被遮擋/無法判斷"
];

// --- 輔助函數 ---
function escapeHtmlJs(unsafe) {
    if (typeof unsafe !== 'string') {
        return unsafe === null || typeof unsafe === 'undefined' ? '' : String(unsafe);
    }
    // 更安全的轉義，處理所有關鍵HTML字符
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
        //  .replace(/"/g, """)
         .replace(/'/g, "'");
}

// --- 標籤頁切換邏輯 ---
function openTeacherTab(evt, tabIdToOpen) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabIdToOpen).style.display = "block";
    evt.currentTarget.className += " active";
}

// --- 渲染函數 ---

// 頁簽1：渲染網站活動表格
function populateWebActivityTab(data) {
    const tableBody = document.getElementById('webActivityTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const colspanCount = tableBody.parentElement.querySelector('thead tr').cells.length;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="${colspanCount}" class="text-center">無數據</td></tr>`;
        return;
    }
    
    data.forEach(student => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = student.student_name || 'N/A';
        row.insertCell().textContent = student.total_general_clicks;
        
        const timeCell = row.insertCell();
        const timeDetails = student.time_spent_on_tabs_details;
        if (timeDetails && Object.keys(timeDetails).length > 0) {
            let timeHtml = '<ul class="time-details-list">';
            for (const [tab, time] of Object.entries(timeDetails)) {
                timeHtml += `<li><strong>${escapeHtmlJs(tab)}:</strong> ${escapeHtmlJs(time)}</li>`;
            }
            timeHtml += '</ul>';
            timeCell.innerHTML = timeHtml;
        } else {
            timeCell.textContent = '無記錄';
        }
    });
}

// 頁簽2：渲染課堂行為統計
function populateBehaviorStatsTab(data) {
    const container = document.getElementById('behaviorStatsContainer');
    if (!container) return;
    container.innerHTML = '';

    data.forEach(student => {
        const studentDiv = document.createElement('div');
        studentDiv.className = 'student-behavior-card';
        
        const reportSummary = student.report_summary || {};
        const behaviorStatsFromServer = reportSummary.behavior_statistics || [];

        // 關鍵步驟：將後端返回的列表轉換為一個方便查找的 Map (物件)
        // 例如：{ "做筆記": { category: "做筆記", count: 23, ... }, "喝水": { ... } }
        const statsMap = new Map(behaviorStatsFromServer.map(stat => [stat.behavior_category, stat]));

        let studentHtml = `<h4>${escapeHtmlJs(student.student_name)} (報告日期: ${escapeHtmlJs(reportSummary.report_date || 'N/A')})</h4>`;

        if (behaviorStatsFromServer.length > 0) {
            studentHtml += `
                <div class="table-responsive-wrapper">
                    <table class="dashboard-table compact-table">
                        <thead><tr><th>行為類別</th><th>百分比</th><th>次數</th></tr></thead>
                        <tbody>
            `;
            
            // ★★★ 核心邏輯修改：遍歷我們定義好的完整行為列表 ★★★
            ALL_BEHAVIOR_CATEGORIES.forEach(categoryName => {
                // 從 Map 中查找該行為的數據
                const stat = statsMap.get(categoryName);
                
                // 如果找到了，就用真實數據；如果找不到，就用 0
                const percentage = stat ? stat.percentage : 0;
                const count = stat ? stat.count : 0;

                studentHtml += `
                    <tr>
                        <td>${escapeHtmlJs(categoryName)}</td>
                        <td>${percentage}%</td>
                        <td>${count}</td>
                    </tr>
                `;
            });

            studentHtml += '</tbody></table></div>';
        } else {
            studentHtml += '<p>無可用的行為統計數據。</p>';
        }
        
        studentDiv.innerHTML = studentHtml;
        container.appendChild(studentDiv);
    });
}

// 頁簽3：渲染行為影像瀏覽器 (修正後，可顯示完整列表的版本)
// function populateImageExplorerTab(data) {
//     const container = document.getElementById('imageExplorerContainer');
//     if (!container) return;
//     container.innerHTML = '';

//     data.forEach(student => {
//         const studentDiv = document.createElement('div');
        
//         const accordionBtn = document.createElement('button');
//         accordionBtn.className = 'accordion-btn';
//         accordionBtn.textContent = escapeHtmlJs(student.student_name);
        
//         const panel = document.createElement('div');
//         panel.className = 'panel';

//         const reportSummary = student.report_summary || {};
//         const behaviorIndex = reportSummary.behavior_to_images_index || {};

//         const list = document.createElement('ul');
//         list.className = 'behavior-list';

//         ALL_BEHAVIOR_CATEGORIES.forEach(categoryName => {
//             const images = behaviorIndex[categoryName] || [];
//             const reportFilename = reportSummary.latest_report_filename;
            
//             const listItem = document.createElement('li');
//             listItem.className = 'behavior-item';

//             // 創建行為標題部分
//             const behaviorTitle = document.createElement('div');
//             behaviorTitle.className = 'behavior-title'; // 給予 class 方便控制樣式
//             behaviorTitle.textContent = `${escapeHtmlJs(categoryName)} (${images.length} 張)`;
//             listItem.appendChild(behaviorTitle);

//             // 創建一個容器來放圖片，預設隱藏
//             const imageGrid = document.createElement('div');
//             imageGrid.className = 'image-grid'; // 重用您已有的樣式
//             imageGrid.style.display = 'none';

//             // 只有當有圖片時，才讓標題可以點擊展開，並生成圖片
//             if (images.length > 0) {
//                 listItem.classList.add('has-images'); // 方便 CSS 標識

//                 images.forEach(imageFile => {
//                     const imgWrapper = document.createElement('div');
//                     imgWrapper.className = 'taggable-image-wrapper'; // 重用您的 class

//                     // 將所有需要的數據存儲在 dataset 中
//                     imgWrapper.dataset.studentName = student.student_name;
//                     imgWrapper.dataset.reportFilename = reportFilename;
//                     imgWrapper.dataset.imageFilename = imageFile;
//                     imgWrapper.dataset.originalBehavior = categoryName;
//                     const uniqueId = `${reportFilename}-${imageFile}`;
//                     imgWrapper.dataset.uniqueId = uniqueId;

//                     // 檢查這張圖片是否已經被標註過
//                     if (taggedImageIdentifiers.has(uniqueId)) {
//                         imgWrapper.classList.add('tagged');
//                     }

//                     const img = document.createElement('img');
//                     img.src = `/api/get_sequence_image?report_file=${encodeURIComponent(reportFilename)}&image_file=${encodeURIComponent(imageFile)}`;
//                     img.loading = 'lazy';
                    
//                     // 【關鍵修改】點擊圖片時，呼叫您已經寫好的 enterFocusMode 函式
//                     imgWrapper.onclick = function() {
//                         if (!this.classList.contains('tagged')) {
//                             enterFocusMode(this.dataset);
//                         } else {
//                             alert("此影像已被校準。");
//                         }
//                     };

//                     imgWrapper.appendChild(img);
//                     imageGrid.appendChild(imgWrapper);
//                 });
                
//                 // 讓行為標題可以點擊展開/收合圖片網格
//                 behaviorTitle.classList.add('clickable');
//                 behaviorTitle.onclick = () => {
//                     imageGrid.style.display = imageGrid.style.display === 'none' ? 'grid' : 'none';
//                      // 展開後重新計算 panel 高度
//                     if (panel.style.maxHeight) {
//                         panel.style.maxHeight = panel.scrollHeight + "px";
//                     }
//                 };

//             } else {
//                 listItem.classList.add('disabled');
//             }
            
//             listItem.appendChild(imageGrid); // 將圖片容器加入列表項
//             list.appendChild(listItem);
//         });

//         panel.appendChild(list);

//         accordionBtn.onclick = function() {
//             this.classList.toggle("active");
//             if (panel.style.maxHeight) {
//                 panel.style.maxHeight = null;
//             } else {
//                 panel.style.maxHeight = panel.scrollHeight + "px";
//             } 
//         };

//         studentDiv.appendChild(accordionBtn);
//         studentDiv.appendChild(panel);
//         container.appendChild(studentDiv);
//     });
// }

function populateImageExplorerTab(data) {
    const container = document.getElementById('imageExplorerContainer');
    if (!container) return;
    container.innerHTML = '';

    data.forEach(student => {
        const studentDiv = document.createElement('div');
        
        const accordionBtn = document.createElement('button');
        accordionBtn.className = 'accordion-btn';
        accordionBtn.textContent = escapeHtmlJs(student.student_name);
        
        const panel = document.createElement('div');
        panel.className = 'panel';

        const reportSummary = student.report_summary || {};
        const behaviorIndex = reportSummary.behavior_to_images_index || {};

        const list = document.createElement('ul');
        list.className = 'behavior-list';

        ALL_BEHAVIOR_CATEGORIES.forEach(categoryName => {
            const images = behaviorIndex[categoryName] || [];
            const reportFilename = reportSummary.latest_report_filename;
            
            // 【關鍵修改】直接從 summary 中獲取經過驗證的報告日期
            const verifiedReportDate = reportSummary.report_date; // e.g., "2025-08-23"

            const listItem = document.createElement('li');
            listItem.className = 'behavior-item';

            const behaviorTitle = document.createElement('div');
            behaviorTitle.className = 'behavior-title';
            behaviorTitle.textContent = `${escapeHtmlJs(categoryName)} (${images.length} 張)`;
            listItem.appendChild(behaviorTitle);

            const imageGrid = document.createElement('div');
            imageGrid.className = 'image-grid';
            imageGrid.style.display = 'none';

            if (images.length > 0 && reportFilename) { // 增加一個檢查，確保檔名存在
                listItem.classList.add('has-images');

                images.forEach(imageFile => {
                    const imgWrapper = document.createElement('div');
                    imgWrapper.className = 'taggable-image-wrapper';

                    imgWrapper.dataset.studentName = student.student_name;
                    imgWrapper.dataset.reportFilename = reportFilename;
                    imgWrapper.dataset.imageFilename = imageFile;
                    imgWrapper.dataset.originalBehavior = categoryName;
                    
                    // 【關鍵新增】將驗證過的日期也存入 dataset
                    if (verifiedReportDate) {
                        imgWrapper.dataset.verifiedDate = verifiedReportDate;
                    }

                    const uniqueId = `${reportFilename}-${imageFile}`;
                    imgWrapper.dataset.uniqueId = uniqueId;

                    if (taggedImageIdentifiers.has(uniqueId)) {
                        imgWrapper.classList.add('tagged');
                    }

                    const img = document.createElement('img');
                    img.src = `/api/get_sequence_image?report_file=${encodeURIComponent(reportFilename)}&image_file=${encodeURIComponent(imageFile)}`;
                    img.loading = 'lazy';
                    
                    imgWrapper.onclick = function() {
                        if (!this.classList.contains('tagged')) {
                            enterFocusMode(this.dataset, this); 
                        } else {
                            alert("此影像已被校準。");
                        }
                    };

                    imgWrapper.appendChild(img);
                    imageGrid.appendChild(imgWrapper);
                });
                
                behaviorTitle.classList.add('clickable');
                behaviorTitle.onclick = function() {
                    imageGrid.style.display = imageGrid.style.display === 'none' ? 'grid' : 'none';
                    this.classList.toggle('is-open'); 
                    if (panel.style.maxHeight) {
                        panel.style.maxHeight = panel.scrollHeight + "px";
                    }
                };
            } else {
                listItem.classList.add('disabled');
            }
            
            listItem.appendChild(imageGrid);
            list.appendChild(listItem);
        });

        panel.appendChild(list);

        accordionBtn.onclick = function() {
            this.classList.toggle("active");
            panel.style.maxHeight = panel.style.maxHeight ? null : panel.scrollHeight + "px";
        };

        studentDiv.appendChild(accordionBtn);
        studentDiv.appendChild(panel);
        container.appendChild(studentDiv);
    });
}

function populateCrossStudentTab(data) {
    const container = document.getElementById('crossStudentImageContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!data || Object.keys(data).length === 0) {
        container.innerHTML = '<p class="text-center">此日期無可供瀏覽的行為影像。</p>';
        return;
    }

    const accordionContainer = document.createElement('div');
    for (const [behavior, imagesWithInfo] of Object.entries(data)) {
        const behaviorDiv = document.createElement('div');
        
        const accordionBtn = document.createElement('button');
        accordionBtn.className = 'accordion-btn';
        accordionBtn.textContent = `${escapeHtmlJs(behavior)} (${imagesWithInfo.length} 張)`;
        
        const panel = document.createElement('div');
        panel.className = 'panel';

        const gridDiv = document.createElement('div');
        gridDiv.className = 'image-grid';

        // 將 gridDiv 放入 panel，以便後續操作
        panel.appendChild(gridDiv);
        
        let currentIndex = 0; // 追蹤當前已載入圖片的索引

        // 核心功能：渲染一個批次的圖片
        function renderBatch() {
            const fragment = document.createDocumentFragment(); // 使用文檔碎片以提升性能
            const limit = Math.min(currentIndex + BATCH_SIZE, imagesWithInfo.length);

            for (let i = currentIndex; i < limit; i++) {
                const info = imagesWithInfo[i];
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'taggable-image-wrapper';
                // ... (複製您原有的 data-* 屬性設定和圖片創建邏輯)
                imgWrapper.dataset.studentName = info.student_name;
                imgWrapper.dataset.reportFilename = info.report_filename;
                imgWrapper.dataset.imageFilename = info.image_filename;
                imgWrapper.dataset.originalBehavior = behavior;
                const uniqueId = `${info.report_filename}-${info.image_filename}`;
                imgWrapper.dataset.uniqueId = uniqueId;

                if (taggedImageIdentifiers.has(uniqueId)) {
                    imgWrapper.classList.add('tagged');
                }

                const img = document.createElement('img');
                img.src = `/api/get_sequence_image?report_file=${encodeURIComponent(info.report_filename)}&image_file=${encodeURIComponent(info.image_filename)}`;
                img.loading = 'lazy';
                const labelDiv = document.createElement('div');
                labelDiv.className = 'image-grid-label';
                labelDiv.textContent = escapeHtmlJs(info.student_name);
                
                imgWrapper.appendChild(img);
                imgWrapper.appendChild(labelDiv);
                fragment.appendChild(imgWrapper);
            }
            gridDiv.appendChild(fragment);
            currentIndex = limit;

            // 移除舊的 "載入更多" 按鈕 (如果有的話)
            const oldLoadMoreBtn = panel.querySelector('.load-more-button');
            if (oldLoadMoreBtn) oldLoadMoreBtn.remove();

            // 如果還有更多圖片未載入，則創建新的 "載入更多" 按鈕
            if (currentIndex < imagesWithInfo.length) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.className = 'load-more-button';
                loadMoreBtn.textContent = `載入更多 (${currentIndex} / ${imagesWithInfo.length})`;
                loadMoreBtn.onclick = () => {
                    renderBatch();
                    // 重新計算 panel 的 maxHeight 以適應新內容
                    if (panel.style.maxHeight) {
                        panel.style.maxHeight = panel.scrollHeight + "px";
                    }
                };
                panel.appendChild(loadMoreBtn);
            }
        }

        accordionBtn.onclick = function() {
            this.classList.toggle("active");
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                // 首次展開時，只載入第一批
                if (currentIndex === 0) {
                    renderBatch();
                }
                panel.style.maxHeight = panel.scrollHeight + "px";
            } 
        };
        
        behaviorDiv.appendChild(accordionBtn);
        behaviorDiv.appendChild(panel);
        accordionContainer.appendChild(behaviorDiv);
    }
    container.appendChild(accordionContainer);
}

// --- 主邏輯：頁面加載完成後執行 ---
document.addEventListener('DOMContentLoaded', function() {
    // --- 獲取所有需要的DOM元素 ---
    const dateSelector = document.getElementById('dateSelector');
    const loadReportButton = document.getElementById('loadReportButton');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessage = document.getElementById('errorMessage');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // 新增：標註與匯出功能相關的元素
    const exportButton = document.getElementById('exportButton');
    const tagCountSpan = document.getElementById('tagCount');
    const crossStudentImageContainer = document.getElementById('crossStudentImageContainer');
    const focusOverlay = document.getElementById('focusTaggingOverlay');
    const closeFocusBtn = focusOverlay.querySelector('.close-focus-btn');
    const saveTagButton = document.getElementById('saveTagButton');
    const correctBehaviorSelect = document.getElementById('correctBehavior');

    // --- 初始化頁面 ---
    async function initializePage() {
        // 【關鍵修改】非同步地從後端 API 載入歷史標註紀錄
        try {
            const response = await fetch('/api/teacher/get_calibrations');
            if (!response.ok) throw new Error('無法獲取歷史標註');
            
            const historicalTags = await response.json();
            
            // 從返回的詳細數據中，構建出用於 UI 判斷的 ID 集合
            const historicalIds = historicalTags.map(tag => {
                // 從 tag.source_report 和 tag.image_path 中重建 uniqueId
                const reportFilename = tag.source_report;
                const imageFilename = tag.image_path.split('\\').pop(); // 從路徑中提取檔名
                return `${reportFilename}-${imageFilename}`;
            });

            taggedImageIdentifiers = new Set(historicalIds);
            console.log(`成功從伺服器載入 ${taggedImageIdentifiers.size} 筆歷史標註紀錄。`);

        } catch (e) {
            console.error("從伺服器讀取標註紀錄失敗:", e);
            taggedImageIdentifiers = new Set(); // 出錯時重置
        }
    
        tabContents.forEach(tab => tab.style.display = 'none');
        loadReportButton.disabled = true;
        populateBehaviorDropdown();
        fetchAvailableDates();
    }
    
    // --- 新增：填充行為下拉選單 ---
    function populateBehaviorDropdown() {
        ALL_BEHAVIOR_CATEGORIES.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            correctBehaviorSelect.appendChild(option);
        });
    }

    // --- API 呼叫：獲取可用的報告日期 ---
    function fetchAvailableDates() {
        loadingMessage.style.display = 'block';
        loadingMessage.textContent = '正在加載可用報告日期...';
        
        fetch('/api/teacher/available_report_dates')
            .then(response => {
                if (!response.ok) throw new Error('無法獲取報告日期列表');
                return response.json();
            })
            .then(dates => {
                dateSelector.innerHTML = '';
                if (dates && dates.length > 0) {
                    // 將 "載入最新報告" 改為提示性文字
                    dateSelector.innerHTML = '<option value="">-- 請選擇日期 --</option>';
                    dates.forEach(date => {
                        const option = document.createElement('option');
                        option.value = date;
                        option.textContent = date;
                        dateSelector.appendChild(option);
                    });
                    loadReportButton.disabled = false;
                    
                    // 【修改點】頁面首次載入時，自動選擇最新的日期並觸發一次查詢
                    dateSelector.value = dates[0]; // 自動選中最新日期 (列表已是降序)
                    loadReportData(); // 自動加載報告
                } else {
                    dateSelector.innerHTML = '<option value="">無可用報告日期</option>';
                    loadingMessage.textContent = '系統中尚無任何報告。';
                }
            })
            .catch(handleError);
}
    
    // --- API 呼叫：根據日期獲取學生摘要數據 ---
    function loadReportData() {
        let selectedDate = dateSelector.value;
        if (selectedDate === "" && dateSelector.options.length > 1) {
            selectedDate = dateSelector.options[1].value;
            dateSelector.value = selectedDate; // 同步更新下拉選單的顯示
        }

        if (!selectedDate) {
            handleError(new Error("沒有可供查詢的報告日期。"));
            return;
        }

        // 【修改點 1.1】新增 comprehensiveApiUrl
        const summaryApiUrl = `/api/teacher/all_students_activity_summary?date=${selectedDate}`;
        const behaviorApiUrl = `/api/teacher/behavior_summary_by_date?date=${selectedDate}`;
        const comprehensiveApiUrl = `/api/teacher/get_comprehensive_report_by_date?date=${selectedDate}`;

        // 更新 UI 狀態
        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在查詢 ${selectedDate} 的報告數據...`;
        errorMessage.style.display = 'none';
        tabContents.forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        // 【修改點 1.2】使用 Promise.all 一次性獲取所有三份數據
        Promise.all([
            fetch(summaryApiUrl).then(res => {
                if (!res.ok) return Promise.reject({ response: res, message: `API Error: ${summaryApiUrl}` });
                return res.json();
            }),
            fetch(behaviorApiUrl).then(res => {
                if (!res.ok) return Promise.reject({ response: res, message: `API Error: ${behaviorApiUrl}` });
                return res.json();
            }),
            fetch(comprehensiveApiUrl).then(res => {
                if (!res.ok) return Promise.reject({ response: res, message: `API Error: ${comprehensiveApiUrl}` });
                return res.json();
            })
        ])
        .then(([summaryData, behaviorData, comprehensiveData]) => {
            if (summaryData.error) throw new Error(summaryData.error);
            if (behaviorData.error) throw new Error(behaviorData.error);
            if (comprehensiveData.error) throw new Error(comprehensiveData.error);
            
            allStudentData = summaryData;
            
            // 【修改點 1.3】調用主渲染函數，傳入所有獲取到的數據
            renderAllTabs(summaryData, behaviorData, comprehensiveData);

            loadingMessage.style.display = 'none';
            
            // 【修改點 1.4】預設打開「課堂綜合洞察」頁籤，並設置其按鈕為 active
            document.getElementById('webActivityTab').style.display = 'block';
            document.querySelector('.tab-button[onclick*="webActivityTab"]').classList.add('active');
        })
        .catch(handleError);
    }

    // --- 統一的錯誤處理函數 ---
    function handleError(error) {
        console.error('操作失敗:', error);
        loadingMessage.style.display = 'none';

        // 【新增】檢查是否為 401 未授權錯誤
        // 這裡我們檢查 response 物件是否存在且 status 為 401
        if (error.response && error.response.status === 401) {
            alert("您的登入已過期，將為您導向登入頁面。");
            // 強制將頁面重新導向到登入頁
            window.location.href = '/login'; 
        } else {
            // 對於其他錯誤，維持原本的顯示方式
            errorMessage.textContent = `錯誤: ${escapeHtmlJs(error.message)}`;
            errorMessage.style.display = 'block';
        }
    }

    // --- 數據渲染主函數 ---
    function renderAllTabs(summaryData, behaviorData, comprehensiveData) {
        // 【新增】渲染新的綜合洞察頁籤
        populateComprehensiveReportTab(comprehensiveData); 
        
        // 調用所有舊頁籤的渲染
        populateWebActivityTab(summaryData);
        populateBehaviorStatsTab(summaryData);
        populateImageExplorerTab(summaryData);
        populateCrossStudentTab(behaviorData);
    }
    // --- 新增：聚焦與標註相關的所有函數 ---
    
    // 進入聚焦模式
    async function enterFocusMode(dataset, element) {
        const container = document.querySelector('.dashboard-container');
        const focusImage = document.getElementById('focusImage');
        const originalBehaviorSpan = document.getElementById('originalBehavior');
        
        // 【修改點 1】獲取新增的 HTML 元素
        const aiReasoningSpan = document.getElementById('aiReasoning');
        const teacherPositionSpan = document.getElementById('teacherPosition');

        focusOverlay.currentTargetElement = element; 

        // 1. 先顯示聚焦面板和一個「載入中...」的提示
        focusOverlay.style.display = 'flex';
        container.classList.add('is-blurred');
        focusImage.src = ""; // 先清空舊圖片
        originalBehaviorSpan.textContent = "正在載入上下文...";
        
        // 【修改點 2】為新增的欄位也設定「載入中」提示
        aiReasoningSpan.textContent = '...';
        teacherPositionSpan.textContent = '...';
        
        // 2. 填充圖片和已知資訊 (不變)
        focusImage.src = `/api/get_sequence_image?report_file=${encodeURIComponent(dataset.reportFilename)}&image_file=${encodeURIComponent(dataset.imageFilename)}`;
        originalBehaviorSpan.textContent = dataset.originalBehavior;

        // 3. 呼叫後端 API 來獲取詳細上下文 (不變)
        let contextData = {};
        try {
            const response = await fetch(`/api/teacher/get_image_context?report_file=${encodeURIComponent(dataset.reportFilename)}&image_file=${encodeURIComponent(dataset.imageFilename)}`);
            if (!response.ok) {
                console.error('獲取上下文失敗');
                // 【修改點 3.1】即使 API 失敗，也要顯示提示文字
                aiReasoningSpan.textContent = "獲取失敗";
                teacherPositionSpan.textContent = "獲取失敗";
            } else {
                contextData = await response.json();
                // 【修改點 3.2】成功獲取數據後，填入對應的欄位
                aiReasoningSpan.textContent = contextData.original_ai_reasoning || "未提供";
                teacherPositionSpan.textContent = contextData.teacher_position || "未知";
            }
        } catch (error) {
            console.error('獲取上下文時發生網路錯誤:', error);
            aiReasoningSpan.textContent = "網路錯誤";
            teacherPositionSpan.textContent = "網路錯誤";
        }

        // 4. 將所有數據存到 dataset 中 (不變)
        const fullDataset = { ...dataset, ...contextData };
        focusOverlay.dataset.currentData = JSON.stringify(fullDataset);

        // 5. 【【【修改】】】 重置表單狀態，增加對新評分元件的重置
        const checkedRadio = document.querySelector('#errorRating input[name="rating"]:checked');
        if(checkedRadio) checkedRadio.checked = false;
        
        // 【【【新增】】】 重置教師信度評分
        const checkedCalRating = document.querySelector('#calibrationConfidence input[name="cal_rating"]:checked');
        if(checkedCalRating) checkedCalRating.checked = false;

        correctBehaviorSelect.value = dataset.originalBehavior;
    }

    // 退出聚焦模式
    function exitFocusMode() {
        const container = document.querySelector('.dashboard-container');
        focusOverlay.style.display = 'none';
        container.classList.remove('is-blurred');
    }

    // 儲存標註
    function saveTag() {
        // 1. 從聚焦面板的 dataset 中獲取所有相關數據
        const fullDataset = JSON.parse(focusOverlay.dataset.currentData);
        
        // 2. 獲取教師在表單中的輸入
        const rating = document.querySelector('#errorRating input[name="rating"]:checked')?.value;
        const correctBehavior = correctBehaviorSelect.value;
        // 【【【新增】】】 獲取教師對自己校準的信度評分
        const calibrationConfidence = document.querySelector('#calibrationConfidence input[name="cal_rating"]:checked')?.value;

        // 3. 驗證是否有選擇評分
        if (!rating) {
            alert('請選擇 AI 的「錯誤程度」評分！');
            return;
        }
        // 【【【新增】】】 驗證教師信度評分
        if (!calibrationConfidence) {
            alert('請評估您此次校準的「信度」！');
            return;
        }

        // --- 【核心修正邏輯開始】--- (這部分邏輯不變)
        let dateFolder = "unknown_date";
        if (fullDataset.report_date_internal && fullDataset.report_date_internal !== "unknown") {
            dateFolder = fullDataset.report_date_internal.replace('/', '');
        }
        let studentIdFolder = `ID_unknown`;
        if (fullDataset.student_number && fullDataset.student_number !== "unknown") {
            studentIdFolder = `ID_${fullDataset.student_number}`;
        }
        const imageFullPath = `C:\\Users\\User\\Desktop\\test\\student_week_photo\\${dateFolder}\\${studentIdFolder}\\Keyframes\\${fullDataset.imageFilename}`;
        // --- 【核心修正邏輯結束】---

        // 7. 【【【修改】】】 構建準備匯出的 JSON 物件，增加新欄位
        const tagObject = {
            image_path: imageFullPath.replace(/\//g, '\\'),
            original_behavior: fullDataset.originalBehavior,
            corrected_behavior: correctBehavior,
            error_rating: parseInt(rating),
            calibration_confidence: parseInt(calibrationConfidence), // 【【【新增欄位】】】
            student_name: fullDataset.studentName,
            source_report: fullDataset.reportFilename,
            timestamp: new Date().toISOString(),
            context: {
                teacher_position: fullDataset.teacher_position || "未知",
                classroom_subject: fullDataset.classroom_subject || "未知",
                seating_position: fullDataset.seating_position || "未知",
                original_ai_reasoning: fullDataset.original_ai_reasoning || "未找到",
                original_ai_confidence: fullDataset.original_ai_confidence || 0.0,
                batch_context: fullDataset.batch_context || null,
                ai_model_version: fullDataset.ai_model_version || null
            }
        };
        
        // 8. 更新前端的狀態和 UI (不變)
        taggingSessionData.push(tagObject);
        taggedImageIdentifiers.add(fullDataset.uniqueId);
        document.getElementById('tagCount').textContent = taggingSessionData.length;
        exportButton.disabled = false;
        
        const originalImageWrapper = focusOverlay.currentTargetElement; 
        if (originalImageWrapper) {
            originalImageWrapper.classList.add('tagged');
        }

        // 9. 退出聚焦模式 (不變)
        exitFocusMode();
    }

    // 匯出數據到後端
    function exportTags() {
        if (taggingSessionData.length === 0) {
            alert('本次操作沒有新增任何標註可供匯出。');
            return;
        }
        const currentTagCount = taggingSessionData.length;

        exportButton.textContent = '正在匯出...';
        exportButton.disabled = true;

        fetch('/api/teacher/export_calibrations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taggingSessionData),
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`伺服器錯誤: ${res.statusText}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success) {
                alert(data.message);
                taggingSessionData = []; // 成功後清空暫存數據
                
                // 【核心修正】使用 innerHTML 恢復按鈕的完整結構，並將計數器設為 0
                exportButton.innerHTML = '匯出校準數據 (<span id="tagCount">0</span>)';
                exportButton.disabled = true; // 保持禁用
            } else {
                throw new Error(data.message || '未知錯誤');
            }
        })
        .catch(err => {
            alert(`匯出失敗: ${err.message}`);
            
            // 【核心修正】出錯時，同樣使用 innerHTML 恢復結構，但顯示【出錯前的數量】
            exportButton.innerHTML = `匯出校準數據 (<span id="tagCount">${currentTagCount}</span>)`;
            exportButton.disabled = false; // 讓使用者可以重試
        });
    }

    // --- 事件監聽 ---
    loadReportButton.addEventListener('click', loadReportData);
    exportButton.addEventListener('click', exportTags);
    closeFocusBtn.addEventListener('click', exitFocusMode);
    saveTagButton.addEventListener('click', saveTag);

    // 使用事件委派處理所有可標註圖片的點擊
    crossStudentImageContainer.addEventListener('click', function(event) {
        const wrapper = event.target.closest('.taggable-image-wrapper');
        if (wrapper && !wrapper.classList.contains('tagged')) {
            // 將找到的 wrapper 元素作為第二個參數傳入
            enterFocusMode(wrapper.dataset, wrapper); 
        } else if (wrapper && wrapper.classList.contains('tagged')) {
            alert("此影像在本輪操作中已被校準。");
        }
    });
    
    // --- 啟動頁面 ---
    initializePage();
});

// 將 openTeacherTab 設為全局可訪問，因為它是從 HTML 的 onclick 屬性中調用的
window.openTeacherTab = openTeacherTab;


function populateComprehensiveReportTab(data) {
    const container = document.getElementById('comprehensiveReportTab');
    const summaryTitle = document.getElementById('summaryTitle');
    const summaryNarrative = document.getElementById('summaryNarrative');
    const summaryKeyTakeaways = document.getElementById('summaryKeyTakeaways');
    const timelineCardsContainer = document.getElementById('timelineAnalysisCards');
    const chartCanvas = document.getElementById('behaviorTrendChart');

    summaryTitle.textContent = '';
    summaryNarrative.textContent = '';
    summaryKeyTakeaways.innerHTML = '';
    timelineCardsContainer.innerHTML = '';

    const reportData = data.report_data;

    if (!reportData || !reportData.timeline_analysis || reportData.timeline_analysis.length === 0) {
        container.querySelector('h3').textContent = "課堂綜合洞察報告 (無數據)";
        summaryTitle.textContent = "此日期暫無綜合報告可供分析。";
        if (behaviorChartInstance) {
            behaviorChartInstance.destroy();
            behaviorChartInstance = null;
        }
        return;
    }
    
    // 1. 渲染宏觀總結
    const overallSummary = reportData.overall_summary;
    summaryTitle.textContent = overallSummary.title || "課堂總結";
    summaryNarrative.textContent = overallSummary.narrative_insight || "無敘事性洞察。";
    
    let takeawaysHtml = '';
    if (overallSummary.key_takeaways) {
        takeawaysHtml += `<p><strong>教學亮點:</strong> ${escapeHtmlJs(overallSummary.key_takeaways.highlight || 'N/A')}</p>`;
        takeawaysHtml += `<p><strong>關鍵挑戰:</strong> ${escapeHtmlJs(overallSummary.key_takeaways.challenge || 'N/A')}</p>`;
        takeawaysHtml += `<p><strong>策略機會:</strong> ${escapeHtmlJs(overallSummary.key_takeaways.opportunity || 'N/A')}</p>`;
    }
    summaryKeyTakeaways.innerHTML = takeawaysHtml;

    // 2. 準備圖表數據並渲染圖表
    const timelineData = reportData.timeline_analysis;
    const labels = timelineData.map(d => d.interval_start);
    
    const datasets = {
        '專注學習(書寫/閱讀)': [], '專注聽講': [], '分心': [], '中性/其他': []
    };

    timelineData.forEach(d => {
        const percentages = d.student_state_summary;
        datasets['專注學習(書寫/閱讀)'].push(percentages['專注學習(書寫/閱讀)'] || 0);
        datasets['專注聽講'].push(percentages['專注聽講'] || 0);
        datasets['分心'].push(percentages['分心'] || 0);
        datasets['中性/其他'].push(percentages['中性/其他'] || 0);
    });

    renderBehaviorTrendChart(chartCanvas, labels, datasets);

    // 3. 渲染逐段洞察卡片
    timelineData.forEach(interval => {
        const card = document.createElement('div');
        card.className = 'timeline-card';
        
        const insight = interval.ai_insight_and_recommendation;

        card.innerHTML = `
            <div class="card-header">
                <h5>時間區段: ${escapeHtmlJs(interval.interval_start)} - ${escapeHtmlJs(interval.interval_end)}</h5>
                <span class="activity-tag">${escapeHtmlJs(interval.teacher_activity_summary.state)}</span>
            </div>
            <div class="card-body">
                <p><strong>教學法洞察:</strong> ${escapeHtmlJs(insight.pedagogical_insight || 'N/A')}</p>
                <p><strong>可行動建議:</strong> ${escapeHtmlJs(insight.actionable_recommendation || 'N/A')}</p>
            </div>
        `;
        timelineCardsContainer.appendChild(card);
    });
}

// 【新增】渲染趨勢圖的函數
function renderBehaviorTrendChart(canvas, labels, datasets) {
    if (behaviorChartInstance) {
        behaviorChartInstance.destroy(); // 銷毀舊圖表以避免重疊
    }
    
    const chartData = {
        labels: labels,
        datasets: [
            // ... (數據集內容與上一版相同)
             {
                label: '專注學習(書寫/閱讀)',
                data: datasets['專注學習(書寫/閱讀)'],
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                fill: true,
                tension: 0.1
            },
            {
                label: '專注聽講',
                data: datasets['專注聽講'],
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                fill: true,
                tension: 0.1
            },
            {
                label: '分心',
                data: datasets['分心'],
                backgroundColor: 'rgba(255, 99, 132, 0.6)',
                borderColor: 'rgba(255, 99, 132, 1)',
                fill: true,
                tension: 0.1
            },
            {
                label: '中性/其他',
                data: datasets['中性/其他'],
                backgroundColor: 'rgba(201, 203, 207, 0.6)',
                borderColor: 'rgba(201, 203, 207, 1)',
                fill: true,
                tension: 0.1
            }
        ]
    };

    behaviorChartInstance = new Chart(canvas, {
        type: 'line', 
        data: chartData,
        options: {
            // ... (圖表選項與上一版相同)
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: false }, tooltip: { mode: 'index', intersect: false } },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
                x: { title: { display: true, text: '課堂時間' } },
                y: { stacked: true, title: { display: true, text: '學生狀態比例 (%)' }, min: 0, max: 100 }
            }
        }
    });
}