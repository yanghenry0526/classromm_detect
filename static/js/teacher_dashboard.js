// static/js/teacher_dashboard.js (全新版本)

// --- 全局變量 ---
let allStudentData = []; // 用於緩存從API獲取的所有學生數據
let taggingSessionData = [];
let behaviorChartInstance = null;
let taggedImageIdentifiers = new Set();
const BATCH_SIZE = 50;

let annotationData = {}; 
let humanAnnotationSessionData = []; 
let currentAnnotationList = [];
let currentAnnotationIndex = 0;

let historicalAnnotationData = {};

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

/**
 * @description 新的、帶有分類的行為數據結構。
 * 用於生成帶有 <optgroup> 的分組下拉選單，提升標註體驗。
 */
const BEHAVIOR_CATEGORIES_GROUPED = {
    "視線 (Gaze)": [
        "目視教師", "目視黑板", "目視書本/筆記", "目視同學", "目視他處"
    ],
    "肢體(手部) (Hand)": [
        "做筆記", "翻書", "觸摸臉部", "觸摸頭髮"
    ],
    "身體姿態 (Posture)": [
        "坐姿直立", "身體前傾", "身體後靠", "低頭(非學習)", "趴睡", "托腮"
    ],
    "互動 (Interaction)": [
        "主動舉手", "被動舉手"
    ],
    "其他狀態 (Other)": [
        "喝水", "飲食", "玩弄手部/文具", "被遮擋/無法判斷"
    ]
};

/**
 * @description 【全新函數】一個新的下拉選單填充函數。
 * 它會讀取 BEHAVIOR_CATEGORIES_GROUPED 數據，並生成帶有分類標題的分組下拉選單。
 * @param {HTMLSelectElement} selectElement - 需要被填充的 <select> DOM 元素。
 */
function populateGroupedBehaviorDropdown(selectElement) {
    if (!selectElement) {
        console.error("錯誤：傳入 populateGroupedBehaviorDropdown 的 selectElement 為空！");
        return;
    }
    selectElement.innerHTML = ''; // 開始前先清空

    // 遍歷我們定義好的分類物件
    for (const categoryName in BEHAVIOR_CATEGORIES_GROUPED) {
        // 1. 為每個分類創建一個 <optgroup> 元素
        const optgroup = document.createElement('optgroup');
        optgroup.label = `--- ${categoryName} ---`; // 設置分類標題，加上分隔線更清晰

        // 2. 遍歷該分類下的所有行為
        const behaviors = BEHAVIOR_CATEGORIES_GROUPED[categoryName];
        behaviors.forEach(behaviorLabel => {
            // 3. 為每個行為創建 <option>
            const option = document.createElement('option');
            option.value = behaviorLabel;
            option.textContent = behaviorLabel;
            // 4. 將 <option> 加入到 <optgroup> 中
            optgroup.appendChild(option);
        });

        // 5. 最後將整個 <optgroup> 加入到下拉選單中
        selectElement.appendChild(optgroup);
    }
}

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

    // 【新增】獲取校準工作台相關的DOM元素
    const annotationWorkbenchTab = document.getElementById('annotationWorkbenchTab');
    const annotationStudentList = document.getElementById('annotationStudentList');
    const annotationInterface = document.getElementById('annotationInterface');
    const annotationPlaceholder = document.getElementById('annotationPlaceholder');
    const prevImageBtn = document.getElementById('prevImageBtn');
    const nextImageBtn = document.getElementById('nextImageBtn');
    const saveAnnotationBtn = document.getElementById('saveAnnotationBtn');
    const exportAnnotationsButton = document.getElementById('exportAnnotationsButton');
    const annoCorrectBehaviorSelect = document.getElementById('annoCorrectBehavior');


    // --- START: 互動式評分條初始化 ---
    const confidenceSlider = document.getElementById('confidenceSlider');
    if (confidenceSlider) {
        const ratingBlocks = confidenceSlider.querySelectorAll('.rating-block');

        // 滑鼠移入區塊時，高亮自己以及之前的所有區塊
        ratingBlocks.forEach(block => {
            block.addEventListener('mouseover', () => {
                const hoverValue = parseInt(block.dataset.value);
                ratingBlocks.forEach(b => {
                    const value = parseInt(b.dataset.value);
                    b.classList.toggle('highlight', value <= hoverValue);
                });
            });
        });

        // 滑鼠移出整個評分條時，恢復到上次點擊的狀態
        confidenceSlider.addEventListener('mouseout', () => {
            const selectedValue = parseInt(confidenceSlider.dataset.selectedValue) || 0;
            ratingBlocks.forEach(b => {
                const value = parseInt(b.dataset.value);
                b.classList.remove('highlight');
                if (value <= selectedValue) {
                    b.classList.add('highlight');
                }
            });
        });

        // 點擊區塊時，設定最終選中的狀態
        ratingBlocks.forEach(block => {
            block.addEventListener('click', () => {
                const clickedValue = block.dataset.value;
                confidenceSlider.dataset.selectedValue = clickedValue; // 將選中的值存在容器的 dataset 中

                ratingBlocks.forEach(b => {
                    b.classList.remove('active');
                });
                block.classList.add('active');
            });
        });
    }

    // --- 初始化頁面 ---
    async function initializePage() {
        // 1. 異步獲取歷史標註數據 (這部分邏輯不變)
        try {
            const response = await fetch('/api/teacher/get_calibrations');
            if (!response.ok) throw new Error('無法獲取歷史標註');
            
            const historicalTags = await response.json();
            
            const historicalIds = historicalTags.map(tag => {
                const reportFilename = tag.source_report;
                const imageFilename = tag.image_path.split('\\').pop();
                return `${reportFilename}-${imageFilename}`;
            });

            taggedImageIdentifiers = new Set(historicalIds);
            console.log(`成功從伺服器載入 ${taggedImageIdentifiers.size} 筆歷史標註紀錄。`);

        } catch (e) {
            console.error("從伺服器讀取標註紀錄失敗:", e);
            taggedImageIdentifiers = new Set();
        }

        // 2. 初始化UI狀態
        tabContents.forEach(tab => tab.style.display = 'none');
        loadReportButton.disabled = true;

        // 3. 【修正】為兩個不同的下拉選單分別填充行為選項
        populateBehaviorDropdown(correctBehaviorSelect); // 填充舊的「聚焦模式」下拉選單
        populateGroupedBehaviorDropdown(annoCorrectBehaviorSelect); // 填充新的「校準工作台」下拉選單

        // 4. 開始獲取報告日期
        fetchAvailableDates();
    }
    
    // --- 新增：填充行為下拉選單 ---
    function populateBehaviorDropdown(selectElement) {
        if (!selectElement) return; // 安全檢查
        selectElement.innerHTML = ''; // 先清空

        // 使用 Set 去除 ALL_BEHAVIOR_CATEGORIES 中的重複項
        const uniqueBehaviors = [...new Set(ALL_BEHAVIOR_CATEGORIES)];

        uniqueBehaviors.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            selectElement.appendChild(option);
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
            selectedDate = dateSelector.options[1] ? dateSelector.options[1].value : dateSelector.options[0].value;
            dateSelector.value = selectedDate;
        }

        if (!selectedDate) {
            handleError(new Error("沒有可供查詢的報告日期。"));
            return;
        }

        const summaryApiUrl = `/api/teacher/all_students_activity_summary?date=${selectedDate}`;
        const behaviorApiUrl = `/api/teacher/behavior_summary_by_date?date=${selectedDate}`;
        const comprehensiveApiUrl = `/api/teacher/get_comprehensive_report_by_date?date=${selectedDate}`;
        const samplingApiUrl = `/api/teacher/get_sampled_images_for_annotation?date=${selectedDate}`;

        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在查詢 ${selectedDate} 的報告數據...`;
        errorMessage.style.display = 'none';
        tabContents.forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        Promise.all([
            fetch(summaryApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${summaryApiUrl}`))),
            fetch(behaviorApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${behaviorApiUrl}`))),
            fetch(comprehensiveApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${comprehensiveApiUrl}`))),
            fetch(samplingApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${samplingApiUrl}`)))
        ])
        .then(([summaryData, behaviorData, comprehensiveData, sampledAndHistoryData]) => { 
            // 檢查各 API 是否返回錯誤
            if (summaryData.error) throw new Error(summaryData.error);
            if (behaviorData.error) throw new Error(behaviorData.error);
            if (comprehensiveData.error) throw new Error(comprehensiveData.error);
            if (sampledAndHistoryData.error) throw new Error(sampledAndHistoryData.error);
            
            // 【核心修改】將後端返回的整合數據拆分並存入全局變量
            const sampledData = sampledAndHistoryData.sampled_images;
            historicalAnnotationData = sampledAndHistoryData.historical_annotations;

            // 將 annotationData 指向抽樣出的圖片列表，供後續使用
            annotationData = sampledData; 
            
            // 將拆分後的抽樣數據 (sampledData) 傳遞給渲染函數
            renderAllTabs(summaryData, behaviorData, comprehensiveData, sampledData);

            loadingMessage.style.display = 'none';
            
            // 預設打開第一個頁籤
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
    function renderAllTabs(summaryData, behaviorData, comprehensiveData, sampledData) { // 【修正】接收第四個參數 sampledData
        // 渲染所有舊的頁籤 (這部分不變)
        populateWebActivityTab(summaryData);
        populateBehaviorStatsTab(summaryData);
        populateImageExplorerTab(summaryData);
        populateCrossStudentTab(behaviorData);
        populateComprehensiveReportTab(comprehensiveData); 
        
        // 【修正】將抽樣數據 (sampledData) 傳遞給新的渲染函數
        populateAnnotationWorkbenchTab(sampledData); 
    }
    // --- 新增：聚焦與標註相關的所有函數 ---

    function populateAnnotationWorkbenchTab(data) {
        annotationStudentList.innerHTML = '';
        humanAnnotationSessionData = []; // 重置本輪會話數據
        updateAnnotationCount(); // 更新計數器為 0

        if (!data || Object.keys(data).length === 0) {
            const li = document.createElement('li');
            li.textContent = '此日期無待標註影像';
            li.className = 'disabled';
            annotationStudentList.appendChild(li);
            // 確保標註介面是隱藏的
            annotationInterface.style.display = 'none';
            annotationPlaceholder.style.display = 'block';
            return;
        }

        // 恢復介面到初始狀態
        annotationInterface.style.display = 'none';
        annotationPlaceholder.style.display = 'block';

        for (const studentName in data) {
            const images = data[studentName];
            const li = document.createElement('li');
            // 顯示總圖片數
            li.textContent = `${studentName} (${images.length} 張)`;
            li.dataset.studentName = studentName;
            
            li.onclick = () => {
                // 移除其他學生的 'active' class
                document.querySelectorAll('#annotationStudentList li.active').forEach(el => el.classList.remove('active'));
                // 為當前點擊的學生添加 'active' class
                li.classList.add('active');
                
                // 呼叫啟動函數
                startAnnotationForStudent(studentName, images);
            };
            annotationStudentList.appendChild(li);
        }
}
    /**
     * @description 【重新補回的函數】當使用者點擊學生列表時，啟動該學生的標註工作流程。
     * @param {string} studentName - 被選中的學生姓名。
     * @param {Array} images - 該學生的待標註圖片列表。
     */
    function startAnnotationForStudent(studentName, images) {
        // 1. 設定當前要標註的圖片列表和起始索引
        currentAnnotationList = images;
        currentAnnotationIndex = 0;

        // 2. 切換介面顯示：隱藏提示文字，顯示標註主介面
        annotationPlaceholder.style.display = 'none';
        annotationInterface.style.display = 'block';

        // 3. 更新介面上的學生姓名
        document.getElementById('annotationStudentName').textContent = `正在標註: ${studentName}`;
        
        // 4. 呼叫 displayAnnotationImage 來顯示第一張圖片
        displayAnnotationImage(currentAnnotationIndex);
    }
    
    // --- 【全新函數】開始為特定學生標註 ---
    async function displayAnnotationImage(index) {
        // 1. 基本檢查與變數設定
        if (index < 0 || index >= currentAnnotationList.length) return;

        const imageData = currentAnnotationList[index];
        const imageEl = document.getElementById('annotationImage');
        const statusOverlay = document.getElementById('annotationStatusOverlay'); // 獲取狀態覆蓋層元素
        
        document.getElementById('annotationProgress').textContent = `影像 ${index + 1} / ${currentAnnotationList.length}`;
        imageEl.src = ""; 

        // 在函數開頭，總是先隱藏覆蓋層，為動畫做準備
        if (statusOverlay) {
            statusOverlay.style.opacity = '0';
            // 使用 setTimeout 確保在下一次顯示前，display 屬性不會阻礙動畫
            setTimeout(() => { if (statusOverlay.style.opacity === '0') statusOverlay.style.display = 'none'; }, 300);
        }

        // 2. 定義更新教室情境圖的輔助函數
        const updateClassroomLayout = (studentPos, teacherPos) => {
            const teacherAreaWrapper = document.querySelector('.position-zone-wrapper');
            const statusMessage = document.getElementById('teacherPositionStatus');
            if (!teacherAreaWrapper || !statusMessage) {
                console.error("錯誤：找不到教室佈局圖的必要元素！");
                return;
            }

            // 重置所有狀態
            document.querySelectorAll('.desk.student-active').forEach(d => d.classList.remove('student-active'));
            document.querySelectorAll('.position-zone.teacher-active').forEach(z => z.classList.remove('teacher-active'));
            teacherAreaWrapper.classList.remove('unknown-state');
            statusMessage.style.display = 'none';

            // 處理學生位置
            if (studentPos && studentPos !== '未知' && studentPos !== '獲取失敗') {
                const rowMap = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5' };
                const colMap = { '左邊': 'left', '中間': 'center', '右邊': 'right' };
                const match = studentPos.match(/第?(\S)排(\S+)/);
                if (match) {
                    const row = rowMap[match[1]], col = colMap[match[2]];
                    if (row && col) {
                        const studentDesk = document.querySelector(`.desk[data-position="${row}-${col}"]`);
                        if (studentDesk) studentDesk.classList.add('student-active');
                    }
                }
            }

            // 處理教師位置
            const perspectiveMap = { "右": "左", "中間偏右": "偏左", "中": "中", "中間": "中", "中間偏左": "偏右", "左": "右" };
            const mappedPosition = teacherPos ? perspectiveMap[teacherPos] : null;
            
            if (mappedPosition) {
                const teacherZone = document.querySelector(`.position-zone[data-position="${mappedPosition}"]`);
                if (teacherZone) teacherZone.classList.add('teacher-active');
            } else {
                teacherAreaWrapper.classList.add('unknown-state');
                statusMessage.textContent = '教師位置資訊無法判斷';
                statusMessage.style.display = 'block';
            }
        };

        // 3. 定義更新互動式評分條的輔助函數
        const setSliderValue = (value) => {
            const confidenceSlider = document.getElementById('confidenceSlider');
            if (!confidenceSlider) return;

            const ratingBlocks = confidenceSlider.querySelectorAll('.rating-block');
            const numericValue = parseInt(value) || 0;
            
            confidenceSlider.dataset.selectedValue = numericValue;
            
            ratingBlocks.forEach(b => {
                const blockValue = parseInt(b.dataset.value);
                b.classList.toggle('active', blockValue === numericValue);
                b.classList.toggle('highlight', blockValue <= numericValue && blockValue > 0);
            });
        };

        // 4. 異步獲取上下文資訊並更新 UI
        let contextData = {};
        try {
            updateClassroomLayout(null, null);
            const response = await fetch(`/api/teacher/get_image_context?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`);
            contextData = response.ok ? await response.json() : {};
            updateClassroomLayout(contextData.seating_position, contextData.teacher_position);
        } catch (e) {
            updateClassroomLayout('獲取失敗', '獲取失敗');
        }

        // 5. 加載主要圖片
        imageEl.src = `/api/get_sequence_image?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`;
        
        // 6. 檢查圖片是否已標註過，並更新表單和狀態標籤
        const imageFullPath = buildImagePath(imageData, contextData);
        const sessionAnnotation = humanAnnotationSessionData.find(item => item.image_path === imageFullPath);
        const historicalAnnotation = historicalAnnotationData[imageFullPath];
        const finalAnnotation = sessionAnnotation || historicalAnnotation;

        if (finalAnnotation) {
            // 如果找到了標註，載入其內容
            annoCorrectBehaviorSelect.value = finalAnnotation.corrected_behavior;
            setSliderValue(finalAnnotation.calibration_confidence);

            // 【核心修改：顯示「已校準」覆蓋層】
            if (statusOverlay) {
                statusOverlay.style.display = 'flex'; // 先讓它在 DOM 中可見
                // 使用一個微小的延遲來確保瀏覽器渲染了 display 屬性的變化，從而觸發 opacity 的過渡動畫
                setTimeout(() => {
                    statusOverlay.style.opacity = '1';
                }, 10);
            }

        } else {
            // 如果沒有任何標註，重置表單
            annoCorrectBehaviorSelect.value = imageData.original_behavior;
            setSliderValue(null);
        }

        // 7. 更新導航按鈕的狀態
        prevImageBtn.disabled = index === 0;
        nextImageBtn.disabled = index === currentAnnotationList.length - 1;
    }
    
    /**
     * 儲存當前正在標註的圖片資訊。這是一個異步函數。
     * @returns {Promise<boolean>} - 成功儲存則返回 true，失敗則返回 false。
     */
    async function saveCurrentAnnotation() {
        const selectedBehavior = annoCorrectBehaviorSelect.value;
        // 【【【 核心修正點 】】】
        // 從評分條的 dataset 中獲取選中的值
        const confidenceRating = document.getElementById('confidenceSlider')?.dataset.selectedValue;

        if (!confidenceRating || confidenceRating === "0") { // 增加一個檢查，確保使用者有點擊
            alert('請評估您此次標註的信度！');
            return false;
        }

        const imageData = currentAnnotationList[currentAnnotationIndex];
        let fullContextData = {};
        try {
            const response = await fetch(`/api/teacher/get_image_context?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`);
            if (response.ok) {
                fullContextData = await response.json();
            }
        } catch (e) {
            console.error("獲取上下文時出錯:", e);
        }
        
        const imageFullPath = buildImagePath(imageData, fullContextData);
        if (!imageFullPath) {
            alert("錯誤：無法建構有效的圖片路徑，標註無法儲存。");
            return false;
        }

        const existingIndex = humanAnnotationSessionData.findIndex(item => item.image_path === imageFullPath);

        const annotationObject = {
            image_path: imageFullPath,
            original_behavior: imageData.original_behavior,
            corrected_behavior: selectedBehavior,
            // error_rating: 0, // 這個欄位在校準工作台中似乎不再需要，可以考慮移除
            calibration_confidence: parseInt(confidenceRating),
            student_name: imageData.student_name,
            source_report: imageData.report_filename,
            timestamp: new Date().toISOString(),
            context: {
                teacher_position: fullContextData.teacher_position || "未知",
                classroom_subject: fullContextData.classroom_subject || "未知",
                seating_position: fullContextData.seating_position || "未知",
                original_ai_reasoning: fullContextData.original_ai_reasoning || "未找到",
                original_ai_confidence: fullContextData.original_ai_confidence || 0.0,
                batch_context: fullContextData.batch_context || null,
                ai_model_version: fullContextData.ai_model_version || null
            }
        };

        if (existingIndex > -1) {
            humanAnnotationSessionData[existingIndex] = annotationObject;
        } else {
            humanAnnotationSessionData.push(annotationObject);
        }
        
        updateAnnotationCount();
        return true;
    }

    /**
     * 根據圖片的基礎資訊和從API獲取的上下文，穩健地建構圖片的絕對路徑。
     * @param {object} imageData - 包含 report_filename, image_filename, student_name 的物件。
     * @param {object} contextData - 從 /api/teacher/get_image_context 返回的物件。
     * @returns {string|null} - 成功則返回完整的圖片路徑，失敗則返回 null。
     */
    function buildImagePath(imageData, contextData) {
        // 優先使用從 context API 獲取的權威元數據，因為這最準確
        const dateStr = contextData.report_date_internal; // e.g., "08/24"
        const studentNum = contextData.student_number;

        if (dateStr && studentNum && dateStr !== "unknown" && studentNum !== "unknown") {
            const dateFolder = dateStr.replace('/', '');
            const studentIdFolder = `ID_${studentNum}`;
            return `C:\\Users\\User\\Desktop\\test\\student_week_photo\\${dateFolder}\\${studentIdFolder}\\Keyframes\\${imageData.image_filename}`.replace(/\//g, '\\');
        }
        
        // 如果 API 獲取失敗，則退回到從檔名解析（作為備用方案）
        console.warn("Context API 未返回日期或座號，退回到從檔名推斷路徑。");
        const dateMatch = imageData.report_filename.match(/_(\d{4})(\d{2})(\d{2})_/);
        if (dateMatch) {
            const dateFolder = dateMatch[2] + dateMatch[3]; // MM DD
            // 注意：這裡無法直接獲取座號，只能用學生姓名，這在某些情況下可能不準確
            const studentIdFolder = `ID_${imageData.student_name}`; 
            return `C:\\Users\\User\\Desktop\\test\\student_week_photo\\${dateFolder}\\${studentIdFolder}\\Keyframes\\${imageData.image_filename}`.replace(/\//g, '\\');
        }

        console.error("致命錯誤：無法建構圖片路徑，兩種方法都失敗了。", {imageData, contextData});
        return null; // 如果兩種方法都失敗，返回 null
    }
    // --- 【全新函數】更新標註計數器 ---
    function updateAnnotationCount() {
        // --- Part 1: 更新舊的「聚焦模式」計數器 ---
        const exportButton = document.getElementById('exportButton');
        const tagCountSpan = document.getElementById('tagCount'); // 直接獲取計數器元素

        // 【關鍵修正】確保按鈕和計數器元素都存在才執行更新
        if (exportButton && tagCountSpan) {
            const count = taggingSessionData.length;
            tagCountSpan.textContent = count;
            exportButton.disabled = count === 0;
        }

        // --- Part 2: 更新新的「校準工作台」計數器 ---
        const exportAnnotationsButton = document.getElementById('exportAnnotationsButton');
        const annotationCountSpan = document.getElementById('annotationCount'); // 直接獲取計數器元素

        // 【關鍵修正】同樣，確保兩個相關元素都存在
        if (exportAnnotationsButton && annotationCountSpan) {
            const count = humanAnnotationSessionData.length;
            annotationCountSpan.textContent = count;
            exportAnnotationsButton.disabled = count === 0;
        }
    }

    // --- 【全新函數】匯出人工標註數據 ---
    function exportHumanAnnotations() {
        if (humanAnnotationSessionData.length === 0) return;

        exportAnnotationsButton.textContent = '正在匯出...';
        exportAnnotationsButton.disabled = true;

        fetch('/api/teacher/export_human_annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(humanAnnotationSessionData),
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(data.message);
                humanAnnotationSessionData = []; // 成功後清空
                updateAnnotationCount();
            } else {
                throw new Error(data.message || '未知錯誤');
            }
        })
        .catch(err => {
            alert(`匯出失敗: ${err.message}`);
        })
        .finally(() => {
            exportAnnotationsButton.innerHTML = `匯出本次標註數據 (<span id="annotationCount">${humanAnnotationSessionData.length}</span>)`;
            exportAnnotationsButton.disabled = humanAnnotationSessionData.length === 0;
        });
    }

    prevImageBtn.addEventListener('click', async () => { // 1. 加上 async
        if (currentAnnotationIndex > 0) {
            // 在切換前，如果用戶已經評分，則嘗試自動儲存
            if (document.querySelector('#annoConfidenceRating input:checked')) {
                await saveCurrentAnnotation(); // 2. 使用 await 等待儲存完成
            }
            currentAnnotationIndex--;
            displayAnnotationImage(currentAnnotationIndex);
        }
    });

    nextImageBtn.addEventListener('click', async () => { // 1. 加上 async
        if (currentAnnotationIndex < currentAnnotationList.length - 1) {
            // 在切換前，如果用戶已經評分，則嘗試自動儲存
            if (document.querySelector('#annoConfidenceRating input:checked')) {
                await saveCurrentAnnotation(); // 2. 使用 await 等待儲存完成
            }
            currentAnnotationIndex++;
            displayAnnotationImage(currentAnnotationIndex);
        }
    });

    saveAnnotationBtn.addEventListener('click', async () => { // 1. 加上 async
        // 2. 使用 await 等待儲存完成，並根據返回的 true/false 決定是否提示
        const isSuccess = await saveCurrentAnnotation(); 
        if (isSuccess) {
            alert(`已儲存影像 ${currentAnnotationIndex + 1} 的標註！`);
        }
    });

    exportAnnotationsButton.addEventListener('click', exportHumanAnnotations);
    
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
        const calibrationConfidence = document.querySelector('#calibrationConfidence input[name="cal_rating"]:checked')?.value;

        // 3. 驗證輸入
        if (!rating) {
            alert('請選擇 AI 的「錯誤程度」評分！');
            return;
        }
        if (!calibrationConfidence) {
            alert('請評估您此次校準的「信度」！');
            return;
        }

        // 4. 建構圖片路徑 (邏輯不變)
        let dateFolder = "unknown_date";
        if (fullDataset.report_date_internal && fullDataset.report_date_internal !== "unknown") {
            dateFolder = fullDataset.report_date_internal.replace('/', '');
        }
        let studentIdFolder = `ID_unknown`;
        if (fullDataset.student_number && fullDataset.student_number !== "unknown") {
            studentIdFolder = `ID_${fullDataset.student_number}`;
        }
        const imageFullPath = `C:\\Users\\User\\Desktop\\test\\student_week_photo\\${dateFolder}\\${studentIdFolder}\\Keyframes\\${fullDataset.imageFilename}`;

        // 5. 構建準備匯出的 JSON 物件 (邏輯不變)
        const tagObject = {
            image_path: imageFullPath.replace(/\//g, '\\'),
            original_behavior: fullDataset.originalBehavior,
            corrected_behavior: correctBehavior,
            error_rating: parseInt(rating),
            calibration_confidence: parseInt(calibrationConfidence),
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
        
        // 6. 更新前端的狀態和 UI
        taggingSessionData.push(tagObject);
        taggedImageIdentifiers.add(fullDataset.uniqueId);
        
        // 【【【 關鍵修正點 】】】
        // 呼叫專屬於舊版匯出按鈕的計數器更新函數
        updateTagCount(); 
        
        const originalImageWrapper = focusOverlay.currentTargetElement; 
        if (originalImageWrapper) {
            originalImageWrapper.classList.add('tagged');
        }

        // 7. 退出聚焦模式
        exitFocusMode();
    }

    function updateTagCount() {
        const exportButton = document.getElementById('exportButton');
        // 安全檢查：如果按鈕不存在於當前頁面，則不執行任何操作
        if (!exportButton) return;

        const count = taggingSessionData.length;
        document.getElementById('tagCount').textContent = count;
        exportButton.disabled = count === 0;
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
    dateSelector.addEventListener('change', loadReportData);
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