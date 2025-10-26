// static/js/teacher_dashboard.js (全新版本)

// --- 全局變量 ---
let allStudentData = []; // 用於緩存從API獲取的所有學生數據
let taggingSessionData = [];

let focusChartInstance = null;

let behaviorChartInstance = null;

let teachingModeChartInstance = null;
let teachingCycleChartInstance = null;
let speechRateChartInstance = null;

let taggedImageIdentifiers = new Set();
const BATCH_SIZE = 50;

let annotationData = {}; 
let humanAnnotationSessionData = []; 
let currentAnnotationList = [];
let currentAnnotationIndex = 0;

let currentSequenceIndex = 0;   // 【新增】代表當前是第幾個序列
let sequences = [];             // 【新增】用來存放所有序列的陣列

let filteredAnnotationList = []; // 存放篩選後的圖片列表
let currentFilter = 'all';     // 追蹤當前的篩選狀態, 預設為 'all'

let historicalAnnotationData = {};

let studentProgress = {}; // 用於追蹤每個學生的標註進度 { studentName: { tagged: 0, total: 100 } }

const TEACHING_MODE_STYLES = {
    "教師講解":   { class: 'mode-lecture',     color: '#4A90E2', label: '教師講解' },
    "師生互動":   { class: 'mode-interaction',   color: '#50E3C2', label: '師生互動' },
    "學生練習":   { class: 'mode-practice',      color: '#F5A623', label: '學生練習' },
    "閒聊":       { class: 'mode-chat',          color: '#7ED321', label: '閒聊' },
    "下課休息":   { class: 'mode-break',         color: '#BD10E0', label: '下課休息' },
    "學生考試":   { class: 'mode-exam',          color: '#9013FE', label: '學生考試' },
    "標準互動":   { class: 'mode-interaction', color: '#50E3C2', label: '標準互動' } // 將標準互動歸類到與師生互動相同的樣式
};

const FORMAL_MODES = ["教師講解", "師生互動", "學生練習", "標準互動"];
const INFORMAL_MODES = ["閒聊", "下課休息", "學生考試"];

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
        "做筆記", "翻書", "觸摸臉部", "觸摸頭髮", "托腮"
    ],
    "身體姿態 (Posture)": [
        "坐姿直立", "身體前傾", "身體後靠", "低頭(非學習)", "趴睡"
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
        row.insertCell().textContent = `ID: ${student.student_number}` || 'N/A'; 
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
    
    const saveAnnotationBtn = document.getElementById('saveAnnotationBtn');
    const exportAnnotationsButton = document.getElementById('exportAnnotationsButton');
    const annoCorrectBehaviorSelect = document.getElementById('annoCorrectBehavior');

    const prevSequenceBtn = document.getElementById('prevSequenceBtn');
    const nextSequenceBtn = document.getElementById('nextSequenceBtn');


    const filterButtons = document.querySelectorAll('#annotationFilter .filter-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentFilter = button.dataset.filter;
            applyFilter();
        });
    });

    // 【新增上一張/下一張按鈕的事件監聽】
    prevSequenceBtn.addEventListener('click', () => displaySequence(currentSequenceIndex - 1));
    nextSequenceBtn.addEventListener('click', () => displaySequence(currentSequenceIndex + 1));

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
        populateBehaviorSelector(); // 填充新的「校準工作台」下拉選單

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
        // 獲取選擇的日期，如果沒有選擇，則自動使用最新的日期
        let selectedDate = dateSelector.value;
        if (selectedDate === "" && dateSelector.options.length > 1) {
            selectedDate = dateSelector.options[1] ? dateSelector.options[1].value : dateSelector.options[0].value;
            dateSelector.value = selectedDate;
        }

        if (!selectedDate) {
            handleError(new Error("沒有可供查詢的報告日期。"));
            return;
        }

        // 定義所有需要一次性獲取的API端點
        const summaryApiUrl = `/api/teacher/all_students_activity_summary?date=${selectedDate}`;
        const behaviorApiUrl = `/api/teacher/behavior_summary_by_date?date=${selectedDate}`;
        const comprehensiveApiUrl = `/api/teacher/get_comprehensive_report_by_date?date=${selectedDate}`; // 【新增】綜合洞察報告的API路徑
        const samplingApiUrl = `/api/teacher/get_sampled_images_for_annotation?date=${selectedDate}`;

        // 更新UI狀態，顯示載入訊息
        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在查詢 ${selectedDate} 的報告數據...`;
        errorMessage.style.display = 'none';
        tabContents.forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        // 使用 Promise.all 並行發送所有請求，提升載入速度
        Promise.all([
            fetch(summaryApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${summaryApiUrl}`))),
            fetch(behaviorApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${behaviorApiUrl}`))),
            fetch(comprehensiveApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${comprehensiveApiUrl}`))), // 【修改】在陣列中加入新的 comprehensiveApiUrl
            fetch(samplingApiUrl).then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error: ${samplingApiUrl}`)))
        ])
        // 【修改】回調函數現在會接收第四個參數 comprehensiveData
        .then(([summaryData, behaviorData, comprehensiveData, sampledAndHistoryData]) => { 
            // 檢查每個API的回應是否有錯誤
            if (summaryData.error) throw new Error(summaryData.error);
            if (behaviorData.error) throw new Error(behaviorData.error);
            if (comprehensiveData.error) throw new Error(comprehensiveData.error);
            if (sampledAndHistoryData.error) throw new Error(sampledAndHistoryData.error);
            
            // 處理抽樣與歷史標註數據
            const sampledData = sampledAndHistoryData.sampled_images;
            historicalAnnotationData = sampledAndHistoryData.historical_annotations;
            annotationData = sampledData; 
            
            // 調用統一的渲染主函數，並傳入所有獲取到的數據
            renderAllTabs(summaryData, behaviorData, comprehensiveData, sampledData);

            // 隱藏載入訊息
            loadingMessage.style.display = 'none';
            
            // 預設打開第一個頁籤
            document.getElementById('webActivityTab').style.display = 'block';
            document.querySelector('.tab-button[onclick*="webActivityTab"]').classList.add('active');
        })
        .catch(handleError); // 統一處理任何發生的錯誤
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
    function renderAllTabs(summaryData, behaviorData, comprehensiveData, sampledData) {
        // 渲染所有舊的頁籤
        populateWebActivityTab(summaryData);
        populateBehaviorStatsTab(summaryData);
        populateImageExplorerTab(summaryData);
        populateCrossStudentTab(behaviorData);
        
        // 【【【 在這裡加上這一行！ 】】】
        populateComprehensiveReportTab(comprehensiveData); 
        
        // 渲染校準工作台
        populateAnnotationWorkbenchTab(sampledData); 
}
    // --- 新增：聚焦與標註相關的所有函數 ---

    /**
     * @description 【全新輔助函數】根據進度數據，更新指定學生在列表中的進度條UI。
     * @param {string} studentName - 要更新的學生姓名。
     */
    function updateStudentProgressUI(studentName) {
        const progressData = studentProgress[studentName];
        if (!progressData) return;

        // 透過 data-attribute 精準找到對應學生的 li 元素
        const studentLi = document.querySelector(`#annotationStudentList li[data-student-name="${studentName}"]`);
        if (!studentLi) return;

        const progressBar = studentLi.querySelector('.progress-bar');
        const progressText = studentLi.querySelector('.progress-text');

        if (progressBar && progressText) {
            const percentage = progressData.total > 0 ? (progressData.tagged / progressData.total) * 100 : 0;
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${progressData.tagged} / ${progressData.total}`;
        }
    }

    function populateAnnotationWorkbenchTab(data) {
        annotationStudentList.innerHTML = '';
        humanAnnotationSessionData = []; // 重置本輪會話數據
        studentProgress = {}; // 【重要】每次載入新日期時，重置進度追蹤
        updateAnnotationCount();

        if (!data || Object.keys(data).length === 0) {
            const li = document.createElement('li');
            li.textContent = '此日期無待標註影像';
            li.className = 'disabled';
            annotationStudentList.appendChild(li);
            annotationInterface.style.display = 'none';
            annotationPlaceholder.style.display = 'block';
            return;
        }

        // 恢復介面到初始狀態
        annotationInterface.style.display = 'none';
        annotationPlaceholder.style.display = 'block';

        for (const studentId in data) {
            const currentStudentId = studentId;
            const currentSequences = data[studentId]; // 變數名改為 currentSequences 更清晰

            // 【【【核心修正點】】】
            // 舊的計數方式是 const total = currentSequences.length; (這只會計算序列的數量)
            // 新的計數方式是使用 reduce 方法，將每個序列 (sequence) 的長度 (sequence.length) 累加起來。
            const totalImages = currentSequences.reduce((sum, sequence) => sum + sequence.length, 0);

            // 計算已標註的總張數，也需要遍歷所有序列
            const taggedImages = currentSequences.flat().filter(img => img.is_tagged).length;

            studentProgress[currentStudentId] = { tagged: taggedImages, total: totalImages };

            const li = document.createElement('li');
            li.dataset.studentId = currentStudentId;
            li.dataset.studentName = currentStudentId;
            
            // 使用新的 totalImages 變數來計算百分比和顯示文字
            const percentage = totalImages > 0 ? (taggedImages / totalImages) * 100 : 0;
            li.innerHTML = `
                <span>ID: ${currentStudentId} (${totalImages} 張)</span>
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${percentage}%;"></div>
                </div>
                <span class="progress-text">${taggedImages} / ${totalImages}</span>
            `;
            
            li.onclick = () => {
                document.querySelectorAll('#annotationStudentList li.active').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
                // 傳遞給啟動函數的仍然是完整的序列列表
                startAnnotationForStudent(currentStudentId, currentSequences);
            };
            annotationStudentList.appendChild(li);
        }
    }

    /**
     * @description 【全新輔助函數】根據當前篩選器，更新 filteredAnnotationList
     */
    function applyFilter() {
        const getTagStatus = (imageData) => {
            // 為了在不請求 context 的情況下進行高效篩選，我們優先使用後端返回的 is_tagged
            // 並結合本輪會話的數據進行判斷
            if (imageData.is_tagged) return true;
            
            // 檢查本輪會話是否有標註
            // 注意：這裡的路徑構建不依賴異步 context，可能不是100%準確，但作為篩選足夠了
            const path = buildImagePath(imageData, {}); 
            return humanAnnotationSessionData.some(item => item.image_path === path);
        };

        if (currentFilter === 'all') {
            filteredAnnotationList = [...currentAnnotationList];
        } else if (currentFilter === 'untagged') {
            filteredAnnotationList = currentAnnotationList.filter(img => !getTagStatus(img));
        } else if (currentFilter === 'tagged') {
            filteredAnnotationList = currentAnnotationList.filter(img => getTagStatus(img));
        }
        updateProgressUI(); // 每次篩選後都更新進度顯示
    }

    /**
     * @description 【全新輔助函數】更新進度條的文字和百分比
     */
    function updateProgressUI() {
        const totalCount = currentAnnotationList.length;
        const filteredCount = filteredAnnotationList.length;
        const progressEl = document.getElementById('annotationProgress');

        if (progressEl && currentAnnotationList.length > 0) {
            const currentImage = currentAnnotationList[currentAnnotationIndex];
            const displayIndex = filteredAnnotationList.indexOf(currentImage);
            
            // 根據篩選器模式顯示不同的文字
            let modeText = "全部";
            if (currentFilter === 'untagged') modeText = "未標註";
            if (currentFilter === 'tagged') modeText = "已標註";

            if (displayIndex !== -1) {
                progressEl.textContent = `影像 ${displayIndex + 1} / ${filteredCount} (${modeText}模式)`;
            } else {
                // 如果當前圖片不在篩選列表中，給出提示
                progressEl.textContent = `(請選擇下一張) / ${filteredCount} (${modeText}模式)`;
            }
        }
    }

    /**
     * @description 【全新版本】上下張按鈕的導航邏輯
     * @param {string} direction - 'next' 或 'prev'
     */
    function navigate(direction) {
        if (filteredAnnotationList.length === 0) return;

        const currentImage = currentAnnotationList[currentAnnotationIndex];
        let currentIndexInFiltered = filteredAnnotationList.indexOf(currentImage);

        // 如果當前圖片不在篩選列表中，找到一個合理的起點
        if (currentIndexInFiltered === -1) {
            currentIndexInFiltered = (direction === 'next') ? -1 : 0;
        }

        let nextIndexInFiltered = (direction === 'next') ? currentIndexInFiltered + 1 : currentIndexInFiltered - 1;

        if (nextIndexInFiltered >= 0 && nextIndexInFiltered < filteredAnnotationList.length) {
            const nextImage = filteredAnnotationList[nextIndexInFiltered];
            const newMasterIndex = currentAnnotationList.indexOf(nextImage);
            currentAnnotationIndex = newMasterIndex; 
            displayAnnotationImage(currentAnnotationIndex);
        }
    }

    /**
     * @description 【【【 全新強化版 】】】啟動標註流程，並異步計算和顯示初始進度。
     * @param {string} studentName - 被選中的學生姓名。
     * @param {Array} images - 該學生的待標註圖片列表。
     */
    function startAnnotationForStudent(studentId, images) {
        // --- 【【【核心修改點】】】 ---
        // 後端已經將圖片預先分好序列（一個包含多個數組的數組），
        // 所以我們不再需要前端的複雜時間戳判斷邏輯。
        // 直接將後端傳來的 'images' (現在是 sequences) 賦值給全局變量即可。
        sequences = images;

        if (!sequences || sequences.length === 0) {
            annotationInterface.style.display = 'none';
            annotationPlaceholder.style.display = 'block';
            annotationPlaceholder.textContent = '此學生無待標註影像。';
            return;
        }

        currentSequenceIndex = 0;
        currentAnnotationIndex = 0;

        annotationPlaceholder.style.display = 'none';
        annotationInterface.style.display = 'block';
        document.getElementById('annotationStudentName').textContent = `正在標註 ID: ${studentId}`;
        
        // 直接開始顯示第一個序列
        displaySequence(currentSequenceIndex);
    }

    function displaySequence(seqIndex) {
        if (seqIndex < 0 || seqIndex >= sequences.length) return;
        
        currentSequenceIndex = seqIndex;
        currentAnnotationList = sequences[currentSequenceIndex];
        currentAnnotationIndex = 0; // 默認選中序列的第一張圖
        
        updateSequenceNavButtons();
        renderThumbnails();
        displayAnnotationImage(currentAnnotationIndex);
    }

    function renderThumbnails() {
        const container = document.getElementById('thumbnailContainer');
        container.innerHTML = '';
        
        // --- 【【【 核心修改邏輯開始 】】】 ---
        const MAX_THUMBNAILS = 5; // 設定縮圖列表的最大數量
        const halfWindow = Math.floor(MAX_THUMBNAILS / 2);

        let startIndex = 0;
        let endIndex = currentAnnotationList.length;

        // 只有當序列總長度超過最大限制時，才進行切片
        if (currentAnnotationList.length > MAX_THUMBNAILS) {
            // 計算理想的起始和結束索引，確保當前圖片 (currentAnnotationIndex) 盡量在中間
            startIndex = Math.max(0, currentAnnotationIndex - halfWindow);
            endIndex = startIndex + MAX_THUMBNAILS;

            // 邊界情況處理：如果計算出的結束索引超出了陣列範圍，則進行調整
            if (endIndex > currentAnnotationList.length) {
                endIndex = currentAnnotationList.length;
                startIndex = endIndex - MAX_THUMBNAILS;
            }
        }
        
        // 從完整的序列中，只截取我們計算好的範圍來顯示
        const thumbnailsToRender = currentAnnotationList.slice(startIndex, endIndex);
        
        thumbnailsToRender.forEach((imageData, relativeIndex) => {
            // 關鍵：我們需要知道這張縮圖在【完整序列】中的真實索引
            const trueIndex = startIndex + relativeIndex;

            const wrapper = document.createElement('div');
            wrapper.className = 'thumbnail-wrapper';
            
            // 高亮當前正在標註的主圖
            if (trueIndex === currentAnnotationIndex) {
                wrapper.classList.add('active');
            }

            // 點擊縮圖時，必須使用它在完整序列中的真實索引來切換主圖
            wrapper.onclick = () => {
                displayAnnotationImage(trueIndex);
            };

            const img = document.createElement('img');
            img.src = `/api/get_sequence_image?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`;
            
            if (imageData.is_tagged) {
                const icon = document.createElement('span');
                icon.className = 'status-icon';
                icon.textContent = '✓';
                wrapper.appendChild(icon);
            }

            wrapper.appendChild(img);
            container.appendChild(wrapper);
        });
        // --- 【【【 核心修改邏輯結束 】】】 ---
    }
    
    // --- 【全新函數】開始為特定學生標註 ---

    async function displayAnnotationImage(index) {
        // --- 步驟 1: 初始化與邊界檢查 ---
        if (index < 0 || index >= currentAnnotationList.length) {
            console.warn(`displayAnnotationImage 嘗試訪問無效索引: ${index}`);
            return; // 如果索引超出範圍，則安全退出，防止錯誤
        }
        currentAnnotationIndex = index;

        // --- 步驟 2: 獲取核心數據與 DOM 元素 ---
        const imageData = currentAnnotationList[currentAnnotationIndex];
        
        // 預先獲取所有需要操作的 DOM 元素，提高效率
        const imageEl = document.getElementById('annotationImage');
        const statusOverlay = document.getElementById('annotationStatusOverlay');
        const filenameEl = document.getElementById('mainImageFilename');
        const progressEl = document.getElementById('annotationProgress');
        const behaviorSelector = document.getElementById('behaviorSelector');
        const confidenceSlider = document.getElementById('confidenceSlider');
        
        // 【修改】只獲取用於顯示課堂狀態標題的元素
        const classroomStateTextEl = document.getElementById('classroomStateText');

        // --- 步驟 3: 重置 UI 到「載入中」狀態 ---
        renderThumbnails(); // 更新縮圖列表，高亮當前圖片
        
        imageEl.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // 顯示一個透明像素
        
        filenameEl.textContent = imageData.image_filename;
        progressEl.textContent = `序列 ${currentSequenceIndex + 1} / ${sequences.length} - 影像 ${index + 1} / ${currentAnnotationList.length}`;

        // 重置所有上下文相關的 UI
        if (classroomStateTextEl) classroomStateTextEl.textContent = '查詢中...';
        
        
        // --- 步驟 4: 定義內嵌輔助函數 (保持程式碼封裝性) ---

        // 輔助函數 A: 更新教室佈局圖（學生座位與教師位置）
        const updateClassroomLayout = (studentPos, teacherPos) => {
            const teacherAreaWrapper = document.querySelector('.position-zone-wrapper');
            const statusMessage = document.getElementById('teacherPositionStatus');
            if (!teacherAreaWrapper || !statusMessage) return;

            document.querySelectorAll('.desk.student-active').forEach(d => d.classList.remove('student-active'));
            document.querySelectorAll('.position-zone.teacher-active').forEach(z => z.classList.remove('teacher-active'));
            teacherAreaWrapper.classList.remove('unknown-state');
            statusMessage.style.display = 'none';

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

            const perspectiveMap = { 
                "左側": "右", "中間偏左": "偏右", "中間": "中",
                "中間偏右": "偏左", "右側": "左", "教室前方": "中"
            };
            const mappedPosition = teacherPos ? perspectiveMap[teacherPos] : null;
            if (mappedPosition) {
                const teacherZone = document.querySelector(`.position-zone[data-position="${mappedPosition}"]`);
                if (teacherZone) teacherZone.classList.add('teacher-active');
            } else {
                teacherAreaWrapper.classList.add('unknown-state');
                statusMessage.textContent = teacherPos || '教師位置未知';
                statusMessage.style.display = 'block';
            }
        };
        
        // 輔助函數 B: 更新信度評分條
        const setSliderValue = (value) => {
            if (!confidenceSlider) return;
            const ratingBlocks = confidenceSlider.querySelectorAll('.rating-block');
            const numericValue = parseInt(value) || 0;
            confidenceSlider.dataset.selectedValue = numericValue;
            ratingBlocks.forEach(b => {
                const blockValue = parseInt(b.dataset.value);
                b.classList.remove('active', 'highlight');
                if (blockValue === numericValue) b.classList.add('active');
                if (blockValue <= numericValue && blockValue > 0) b.classList.add('highlight');
            });
        };
        
        // 重置情境圖與信度條
        updateClassroomLayout(null, null);
        setSliderValue(null);


        // --- 步驟 5: 並行地異步獲取所有上下文資訊 ---
        let contextData = {};
        try {
            const selectedDate = document.getElementById('dateSelector').value;
            const reportFile = encodeURIComponent(imageData.report_filename);
            const imageFile = encodeURIComponent(imageData.image_filename);

            // 使用 Promise.all 並行發送所有請求，提升載入速度
            const [contextResponse, positionResponse, stateResponse] = await Promise.all([
                fetch(`/api/teacher/get_image_context?report_file=${reportFile}&image_file=${imageFile}`),
                fetch(`/api/teacher/get_dynamic_teacher_position?date=${selectedDate}&image_file=${imageFile}`),
                fetch(`/api/teacher/get_classroom_state?date=${selectedDate}&image_file=${imageFile}`)
            ]);

            // 處理第一個請求：圖片基本上下文 (學生座位等)
            contextData = contextResponse.ok ? await contextResponse.json() : {};
            
            // 處理第二個請求：動態教師位置
            const positionData = positionResponse.ok ? await positionResponse.json() : { position: "請求失敗" };
            contextData.teacher_position = positionData.position;

            // 處理第三個請求：課堂活動狀態
            if (stateResponse.ok) {
                const stateData = await stateResponse.json();
                // 【修改】只更新標題，不再更新詳細描述
                if(classroomStateTextEl) classroomStateTextEl.textContent = stateData.classroom_state || '未知';
            } else {
                if(classroomStateTextEl) classroomStateTextEl.textContent = '查詢失敗';
            }

            // 使用組合好的、最準確的數據來更新UI
            updateClassroomLayout(contextData.seating_position, contextData.teacher_position);

        } catch (e) {
            console.error("獲取上下文、動態位置或課堂狀態時發生網路錯誤:", e);
            // 如果任何一個請求失敗，都在 UI 上顯示錯誤狀態
            updateClassroomLayout('獲取失敗', '網路錯誤');
            if(classroomStateTextEl) classroomStateTextEl.textContent = '網路錯誤';
        }


        // --- 步驟 6: 載入主預覽圖 ---
        imageEl.src = `/api/get_sequence_image?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`;
        
        
        // --- 步驟 7: 根據歷史標註狀態，更新標註工具列 ---
        const imageFullPath = buildImagePath(imageData, contextData);
        const sessionAnnotation = humanAnnotationSessionData.find(item => item.image_path === imageFullPath);
        const historicalAnnotation = historicalAnnotationData[imageFullPath];
        const finalAnnotation = sessionAnnotation || historicalAnnotation;

        behaviorSelector.querySelectorAll('.behavior-btn').forEach(btn => btn.classList.remove('active'));

        if (imageData.is_tagged) {
            statusOverlay.style.display = 'flex';
            statusOverlay.style.opacity = '1';
            
            if (finalAnnotation) {
                if (finalAnnotation.corrected_behaviors && typeof finalAnnotation.corrected_behaviors === 'object') {
                    for (const categoryKey in finalAnnotation.corrected_behaviors) {
                        const behaviorValue = finalAnnotation.corrected_behaviors[categoryKey];
                        const btnToActivate = behaviorSelector.querySelector(`.behavior-btn[data-value="${behaviorValue}"]`);
                        if (btnToActivate) btnToActivate.classList.add('active');
                    }
                } 
                else if (finalAnnotation.corrected_behavior && typeof finalAnnotation.corrected_behavior === 'string') {
                    const btnToActivate = behaviorSelector.querySelector(`.behavior-btn[data-value="${finalAnnotation.corrected_behavior}"]`);
                    if (btnToActivate) btnToActivate.classList.add('active');
                }
                
                setSliderValue(finalAnnotation.calibration_confidence);
            } else {
                console.warn(`圖片 ${imageData.image_filename} 標記為已標註，但未找到詳細的標註數據。`);
            }

        } else {
            statusOverlay.style.opacity = '0';
            setTimeout(() => {
                if (statusOverlay.style.opacity === '0') {
                    statusOverlay.style.display = 'none';
                }
            }, 300);

            const originalBehaviors = Array.isArray(imageData.original_behavior)
                ? imageData.original_behavior
                : [imageData.original_behavior];

            originalBehaviors.forEach(behavior => {
                if (behavior) {
                    const btnToActivate = behaviorSelector.querySelector(`.behavior-btn[data-value="${behavior}"]`);
                    if (btnToActivate) {
                        btnToActivate.classList.add('active');
                    }
                }
            });

            setSliderValue(null);
        }
    }
    
    async function saveCurrentAnnotation() {
        // --- 步驟 1 & 2: 收集數據與驗證 (邏輯不變) ---
        const activeButtons = document.querySelectorAll('#behaviorSelector .behavior-btn.active');
        const confidenceRating = document.getElementById('confidenceSlider')?.dataset.selectedValue;
        const mandatoryCategories = { "視線 (Gaze)": "視線", "身體姿態 (Posture)": "身體姿態" };
        let missingCategories = [];
        for (const categoryKey in mandatoryCategories) {
            if (!document.querySelector(`#behaviorSelector .behavior-buttons-wrapper[data-category="${categoryKey}"] .behavior-btn.active`)) {
                missingCategories.push(mandatoryCategories[categoryKey]);
            }
        }
        if (missingCategories.length > 0) {
            alert(`儲存失敗！\n\n根據標註規則，您必須為 【${missingCategories.join('】、【')}】 類別各選擇一個行為。`);
            return false;
        }
        if (!confidenceRating || confidenceRating === "0") {
            alert('請評估您此次標註的信度！');
            return false;
        }

        // --- 【【【 核心修改點 1：在所有操作之前，先記錄當前圖片的原始標註狀態 】】】 ---
        const imageData = currentAnnotationList[currentAnnotationIndex];
        // 檢查這張圖片在被點擊「儲存」按鈕的這一刻，是否已經是「已標註」狀態。
        const wasAlreadyTagged = imageData.is_tagged === true;

        // --- 步驟 3 & 4: 組合數據、獲取上下文、建立路徑 (邏輯不變) ---
        const correctedBehaviorsObject = {};
        activeButtons.forEach(btn => {
            const categoryLong = btn.closest('.behavior-buttons-wrapper').dataset.category;
            const behavior = btn.dataset.value;
            correctedBehaviorsObject[categoryLong.split(' ')[0]] = behavior;
        });

        let fullContextData = {};
        try {
            const response = await fetch(`/api/teacher/get_image_context?report_file=${encodeURIComponent(imageData.report_filename)}&image_file=${encodeURIComponent(imageData.image_filename)}`);
            if (response.ok) fullContextData = await response.json();
        } catch (e) {
            console.error("獲取上下文時發生網路錯誤:", e);
        }
        
        const imageFullPath = buildImagePath(imageData, fullContextData);
        if (!imageFullPath) {
            alert("錯誤：無法建構有效的圖片路徑，標註無法儲存。");
            return false;
        }

        // --- 步驟 5: 構建儲存物件 (邏輯不變) ---
        const annotationObject = {
            image_path: imageFullPath,
            original_behavior: imageData.original_behavior,
            corrected_behaviors: correctedBehaviorsObject,
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
        
        // --- 步驟 6: 更新前端狀態與 UI ---

        // 6a. 更新本輪會話的暫存數據 (邏輯不變)
        const existingIndex = humanAnnotationSessionData.findIndex(item => item.image_path === imageFullPath);
        if (existingIndex > -1) {
            humanAnnotationSessionData[existingIndex] = annotationObject;
        } else {
            humanAnnotationSessionData.push(annotationObject);
        }
        updateAnnotationCount();

        // --- 【【【 核心修改點 2：使用步驟 1 記錄的狀態來決定是否增加計數 】】】 ---
        // 只有當這張圖片之前是「未標註」狀態時，才增加進度計數。
        if (!wasAlreadyTagged) {
            const studentId = imageData.student_number;
            if (studentProgress[studentId]) {
                studentProgress[studentId].tagged += 1;
                updateStudentProgressUI(studentId);
            }
        }

        // 6c. 確保圖片的狀態被更新為「已標註」(邏輯不變)
        currentAnnotationList[currentAnnotationIndex].is_tagged = true;

        // 6d. 觸發 UI 重新渲染以顯示最新狀態 (邏輯不變)
        displayAnnotationImage(currentAnnotationIndex);

        // --- 步驟 7: 返回成功 ---
        return true;
    }
    
    // 【全新函數】更新序列導航按鈕的狀態
    function updateSequenceNavButtons() {
        document.getElementById('prevSequenceBtn').disabled = currentSequenceIndex === 0;
        document.getElementById('nextSequenceBtn').disabled = currentSequenceIndex >= sequences.length - 1;
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

        // 從 DOM 獲取按鈕，確保變數有效
        const exportAnnotationsButton = document.getElementById('exportAnnotationsButton');
        if (!exportAnnotationsButton) return; // 安全檢查

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

                // --- 【【【 核心修改邏輯開始 】】】 ---

                // 1. 將本次會話中已成功匯出的數據，合併到前端的歷史數據中。
                //    這樣 displayAnnotationImage 就能在歷史數據中找到它們了。
                humanAnnotationSessionData.forEach(item => {
                    // 使用圖片的完整路徑作為 key，將整個標註物件存入
                    if (item.image_path) { // 確保 image_path 存在
                        historicalAnnotationData[item.image_path] = item;
                    }
                });

                // 2. 現在可以安全地清空本次會話的暫存數據了。
                humanAnnotationSessionData = [];

                // --- 【【【 核心修改邏輯結束 】】】 ---
                
                updateAnnotationCount(); // 更新計數器為 0

            } else {
                throw new Error(data.message || '未知錯誤');
            }
        })
        .catch(err => {
            alert(`匯出失敗: ${err.message}`);
        })
        .finally(() => {
            // 更新按鈕的文字和狀態
            exportAnnotationsButton.innerHTML = `匯出本次標註數據 (<span id="annotationCount">${humanAnnotationSessionData.length}</span>)`;
            exportAnnotationsButton.disabled = humanAnnotationSessionData.length === 0;
        });
    }

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

/**
 * 【全新 v3.0 整合版】渲染宏觀與微觀兩種教學時間軸
 * @param {Array} detailedTimeline - 包含每30秒區間教學模式和語音的數據
 */
function renderContentTimeline(detailedTimeline, timelineAnalysis) {
    const mainContainer = document.getElementById('contentTimelineContainer');
    const tooltip = document.getElementById('contentTimelineTooltip');

    if (!mainContainer || !tooltip || !detailedTimeline || !detailedTimeline.length) {
        if (mainContainer) mainContainer.style.display = 'none';
        return;
    }
    mainContainer.style.display = 'block';

    // --- 輔助函數 ---
    const formatSeconds = (totalSeconds) => {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes} 分 ${seconds} 秒`;
    };

    const totalDuration = detailedTimeline.length * 30;

    // --- 渲染 Part 1: 宏觀時間軸 (Formal vs. Informal) ---
    const macroVisualizer = document.getElementById('macroTimelineVisualizer');
    if (macroVisualizer) {
        let macroSegments = [];
        let currentMacroSegment = null;

        detailedTimeline.forEach(interval => {
            const mode = interval.teaching_mode || '未知狀態';
            const contentType = FORMAL_MODES.includes(mode) ? '正式課文內容' : '課外內容';

            if (!currentMacroSegment || currentMacroSegment.type !== contentType) {
                if (currentMacroSegment) macroSegments.push(currentMacroSegment);
                currentMacroSegment = { type: contentType, duration: 30 };
            } else {
                currentMacroSegment.duration += 30;
            }
        });
        if (currentMacroSegment) macroSegments.push(currentMacroSegment);

        let macroHtml = '<div class="content-timeline-bar">';
        macroSegments.forEach(segment => {
            const percentage = (segment.duration / totalDuration) * 100;
            const typeClass = segment.type === '正式課文內容' ? 'formal-content' : 'informal-content';
            macroHtml += `<div class="timeline-segment ${typeClass}" style="width: ${percentage}%;"></div>`;
        });
        macroHtml += '</div>';
        macroVisualizer.innerHTML = macroHtml;
    }


    // --- 渲染 Part 2: 微觀時間軸 (多種教學模式) ---
    const microLegendContainer = document.getElementById('microTimelineLegendContainer');
    const microVisualizer = document.getElementById('microTimelineVisualizer');

    if (microLegendContainer && microVisualizer) {
        let microSegments = [];
        let currentMicroSegment = null;

        detailedTimeline.forEach(interval => {
            const mode = interval.teaching_mode || '未知狀態';
            if (!currentMicroSegment || currentMicroSegment.type !== mode) {
                if (currentMicroSegment) microSegments.push(currentMicroSegment);
                currentMicroSegment = {
                    type: mode,
                    startTime: interval.start_time,
                    duration: 30,
                    transcript: (interval.teacher_speech || '').trim()
                };
            } else {
                currentMicroSegment.duration += 30;
                const newSpeech = (interval.teacher_speech || '').trim();
                if (newSpeech) currentMicroSegment.transcript += ` ${newSpeech}`;
            }
        });
        if (currentMicroSegment) microSegments.push(currentMicroSegment);

        // 渲染圖例
        const uniqueModesInUse = new Set(microSegments.map(s => s.type));
        let legendHtml = '';
        uniqueModesInUse.forEach(mode => {
            const styleInfo = TEACHING_MODE_STYLES[mode] || { color: '#BDBDBD', label: mode };
            legendHtml += `<div class="legend-item-v2"><span class="legend-color-box-v2" style="background-color: ${styleInfo.color};"></span>${escapeHtmlJs(styleInfo.label)}</div>`;
        });
        microLegendContainer.innerHTML = legendHtml;

        // 渲染時間軸
        let timelineHtml = '<div class="content-timeline-bar">';
        microSegments.forEach(segment => {
            const percentage = (segment.duration / totalDuration) * 100;
            const styleInfo = TEACHING_MODE_STYLES[segment.type] || { class: 'mode-unknown' };
            timelineHtml += `<div class="timeline-segment ${styleInfo.class}" style="width: ${percentage}%;"
                                  data-mode="${escapeHtmlJs(segment.type)}"
                                  data-start="${escapeHtmlJs(segment.startTime)}"
                                  data-duration="${segment.duration}"
                                  data-transcript="${escapeHtmlJs(segment.transcript)}"></div>`;
        });
        timelineHtml += '</div>';
        microVisualizer.innerHTML = timelineHtml;
        
        // --- 事件綁定 (只為微觀時間軸) ---
        microVisualizer.addEventListener('mouseover', (event) => {
            if (event.target.classList.contains('timeline-segment')) {
                const segmentDiv = event.target;
                const styleInfo = TEACHING_MODE_STYLES[segmentDiv.dataset.mode] || { color: '#BDBDBD', label: segmentDiv.dataset.mode };
                const transcriptText = (segmentDiv.dataset.transcript || '無對話記錄');
                const truncatedTranscript = transcriptText.length > 200 ? transcriptText.substring(0, 200) + '...' : transcriptText;

                tooltip.innerHTML = `
                    <div class="tooltip-title"><span class="color-box" style="background-color: ${styleInfo.color};"></span>${escapeHtmlJs(styleInfo.label)}</div>
                    <div class="tooltip-body">
                        <p><strong>開始時間:</strong> ${escapeHtmlJs(segmentDiv.dataset.start)}</p>
                        <p><strong>持續時長:</strong> ${formatSeconds(parseInt(segmentDiv.dataset.duration))}</p>
                    </div>
                    <div class="tooltip-transcript"><strong>逐字稿摘要:</strong><br>${truncatedTranscript}</div>`;
                tooltip.style.display = 'block';
            }
        });
        microVisualizer.addEventListener('mousemove', (event) => {
            tooltip.style.left = `${event.pageX + 15}px`;
            tooltip.style.top = `${event.pageY + 15}px`;
        });
        microVisualizer.addEventListener('mouseout', () => {
            tooltip.style.display = 'none';
        });
    }
}

function populateComprehensiveReportTab(data) {
    // ★★★【修正 1：移除 console.log，保持程式碼乾淨】★★★
    // console.log("--- 進入 populateComprehensiveReportTab ---");
    // console.log("收到的完整報告數據 (data.report_data):", data.report_data);

    // --- 步驟 1: 獲取所有需要的 DOM 元素 (不變) ---
    const summaryTitle = document.getElementById('summaryTitle');
    const summaryNarrative = document.getElementById('summaryNarrative');
    const pacingContainer = document.getElementById('pacingAnalysisContainer');
    const pacingContent = document.getElementById('pacingAnalysisContent');
    const patternContainer = document.getElementById('patternIdentificationContainer');
    const patternContent = document.getElementById('patternIdentificationContent');
    const lexicalContainer = document.getElementById('lexicalHighlightsContainer');
    const lexicalContent = document.getElementById('lexicalHighlightsContent');
    const keywordContainer = document.getElementById('keywordTimestampsContainer');
    const keywordContent = document.getElementById('keywordTimestampsContent');
    const recoContainer = document.getElementById('finalRecommendationsContainer');
    const recoContent = document.getElementById('finalRecommendationsContent');
    const quantitativeChartsContainer = document.getElementById('quantitativeChartsContainer');
    const chartContainer = document.getElementById('focusChartContainer');
    const chartCanvas = document.getElementById('focusPercentageChart');
    const timelineCardsContainer = document.getElementById('timelineAnalysisCards');
    
    // ★★★【修正 2：從 allContainers 列表中移除 contentTimelineContainer】★★★
    // 我們需要手動控制 contentTimelineContainer 的顯示與隱藏
    const allContainers = [pacingContainer, patternContainer, lexicalContainer, recoContainer, chartContainer, quantitativeChartsContainer, keywordContainer];
    allContainers.forEach(c => { if(c) c.style.display = 'none'; });
    
    // 手動處理時間軸容器
    const contentTimelineContainer = document.getElementById('contentTimelineContainer');
    if (contentTimelineContainer) contentTimelineContainer.style.display = 'none';

    if (summaryTitle) summaryTitle.textContent = '正在加載總結...';
    if (summaryNarrative) summaryNarrative.textContent = '';
    if (timelineCardsContainer) timelineCardsContainer.innerHTML = '';
    if (keywordContent) keywordContent.innerHTML = '';
    
    // 銷毀所有舊的圖表實例 (不變)
    if (focusChartInstance) focusChartInstance.destroy();
    if (teachingModeChartInstance) teachingModeChartInstance.destroy();
    if (teachingCycleChartInstance) teachingCycleChartInstance.destroy();
    if (speechRateChartInstance) speechRateChartInstance.destroy();
    focusChartInstance = teachingModeChartInstance = teachingCycleChartInstance = speechRateChartInstance = null;
    
    const reportData = data.report_data;

    // --- 步驟 3: 處理無數據的情況 (不變) ---
    if (!reportData) {
        if (summaryTitle) summaryTitle.textContent = "此日期暫無綜合報告可供分析。";
        return;
    }

    // --- ★★★【修正 3：確保傳遞了正確的數據給時間軸渲染函數】★★★ ---
    // 這個調用位置和參數是正確的，保持不變
    if (reportData.detailed_timeline && reportData.timeline_analysis) {
        renderContentTimeline(reportData.detailed_timeline, reportData.timeline_analysis);
    }
    
    // --- 步驟 4: 渲染頂部摘要與各個分析卡片 (不變) ---
    // ... (此處省略了您所有渲染摘要、節奏、模式、建議的程式碼，它們是正確的) ...
    const overallSummary = reportData.overall_summary;
    if (summaryTitle) summaryTitle.textContent = `課堂總結 (${escapeHtmlJs(reportData.class_session_id)})`;
    if (summaryNarrative && overallSummary) {
        summaryNarrative.textContent = overallSummary.class_narrative || "無敘事性總結。";
    }

    if (overallSummary) {
        if (overallSummary.quantitative_pacing_analysis && pacingContainer && pacingContent) {
            const pacing = overallSummary.quantitative_pacing_analysis;
            pacingContent.innerHTML = `<ul><li><strong>整體節奏:</strong> ${escapeHtmlJs(pacing.overall_rhythm || 'N/A')}</li><li><strong>高負荷安全時長:</strong> ${escapeHtmlJs(pacing.avg_high_load_duration || 'N/A')}</li><li><strong>注意力重置模式:</strong> ${escapeHtmlJs(pacing.attention_reset_patterns || 'N/A')}</li></ul>`;
            pacingContainer.style.display = 'block';
        }
        if (overallSummary.key_pattern_identification && patternContainer && patternContent) {
            const patterns = overallSummary.key_pattern_identification;
            let boosterHtml = '<div class="pattern-column"><h5>🚀 專注度助推器模式</h5>';
            if (patterns.focus_booster_patterns && patterns.focus_booster_patterns.length > 0) { patterns.focus_booster_patterns.forEach(p => { boosterHtml += `<div class="pattern-card booster"><h6>${escapeHtmlJs(p.pattern_name)}</h6><p>${escapeHtmlJs(p.description)}</p><div class="pattern-evidence"><strong>證據:</strong> ${escapeHtmlJs(p.evidence)}</div></div>`; }); } else { boosterHtml += '<p>本次未識別到顯著的助推器模式。</p>'; }
            boosterHtml += '</div>';
            let sinkHtml = '<div class="pattern-column"><h5>📉 專注度陷阱模式</h5>';
            if (patterns.attention_sink_patterns && patterns.attention_sink_patterns.length > 0) { patterns.attention_sink_patterns.forEach(p => { sinkHtml += `<div class="pattern-card sink"><h6>${escapeHtmlJs(p.pattern_name)}</h6><p>${escapeHtmlJs(p.description)}</p><div class="pattern-evidence"><strong>證據:</strong> ${escapeHtmlJs(p.evidence)}</div></div>`; }); } else { sinkHtml += '<p>本次未識別到顯著的陷阱模式。</p>'; }
            sinkHtml += '</div>';
            patternContent.innerHTML = boosterHtml + sinkHtml;
            patternContainer.style.display = 'block';
        }
        if (overallSummary.lexical_trigger_highlights && lexicalContainer && lexicalContent) {
            const lexical = overallSummary.lexical_trigger_highlights;
            lexicalContent.innerHTML = `<div class="lexical-card"><h5>短時間內提高專注詞彙類型</h5><p>${escapeHtmlJs(lexical.positive_trigger_words || '無')}</p></div><div class="lexical-card"><h5>分享時事、故事詞彙類型</h5><p>${escapeHtmlJs(lexical.negative_trigger_words || '無')}</p></div>`;
            lexicalContainer.style.display = 'block';
        }
        if (overallSummary.final_recommendations && recoContainer && recoContent) {
            let recoHtml = '<ul>';
            overallSummary.final_recommendations.forEach(r => { recoHtml += `<li>${escapeHtmlJs(r)}</li>`; });
            recoHtml += '</ul>';
            recoContent.innerHTML = recoHtml;
            recoContainer.style.display = 'block';
        }
    }
    
    // --- 步驟 5: 渲染關鍵詞彙實例區塊 (不變) ---
    // ... (您渲染關鍵詞的程式碼是正確的) ...
     if (reportData.keyword_timestamps && reportData.keyword_timestamps.length > 0 && keywordContainer && keywordContent) {
        // 5a. 數據重組：將陣列轉換為以關鍵詞分組的物件
        const groupedByKeyword = {};
        reportData.keyword_timestamps.forEach(item => {
            if (!groupedByKeyword[item.keyword]) {
                groupedByKeyword[item.keyword] = [];
            }
            groupedByKeyword[item.keyword].push(item);
        });

        // 5b. 生成 HTML 結構
        let keywordsHtml = '';
        for (const keyword in groupedByKeyword) {
            keywordsHtml += `<div class="keyword-group">`;
            keywordsHtml += `  <h5 class="keyword-group-title">${escapeHtmlJs(keyword)}</h5>`;
            keywordsHtml += `  <div class="timestamp-tags">`;
            
            groupedByKeyword[keyword].forEach(item => {
                keywordsHtml += `<span class="timestamp-tag" 
                                    data-context-before="${escapeHtmlJs(item.context_before)}" 
                                    data-context-after="${escapeHtmlJs(item.context_after)}">
                                    ${escapeHtmlJs(item.time)}
                                 </span>`;
            });

            keywordsHtml += `  </div>`;
            keywordsHtml += `</div>`;
        }
        keywordContent.innerHTML = keywordsHtml;
        keywordContainer.style.display = 'block';

        // 5c. 使用事件委派來處理懸浮事件
        const tooltip = document.getElementById('keywordTooltip');
        if (tooltip) {
            keywordContent.addEventListener('mouseover', (event) => {
                if (event.target.classList.contains('timestamp-tag')) {
                    const tag = event.target;
                    const before = tag.dataset.contextBefore;
                    const after = tag.dataset.contextAfter;

                    tooltip.innerHTML = `
                        <div class="tooltip-context before">${before || '--- 無前文 ---'}</div>
                        <div class="tooltip-context-divider">--- 關鍵詞時間點 ---</div>
                        <div class="tooltip-context after">${after || '--- 無後文 ---'}</div>
                    `;
                    tooltip.style.left = `${event.pageX + 15}px`;
                    tooltip.style.top = `${event.pageY + 15}px`;
                    tooltip.style.display = 'block';
                }
            });

            keywordContent.addEventListener('mouseout', (event) => {
                if (event.target.classList.contains('timestamp-tag')) {
                    tooltip.style.display = 'none';
                }
            });
        }
    }
    
    // --- 步驟 6 & 7: 渲染圖表 (不變) ---
    // ... (您渲染圖表的程式碼是正確的) ...
    const quantitativeSummary = reportData.quantitative_summary;
    if (quantitativeSummary && quantitativeChartsContainer) {
        quantitativeChartsContainer.style.display = 'grid';
        if (quantitativeSummary.teaching_mode_distribution) { renderTeachingModeChart(quantitativeSummary.teaching_mode_distribution); }
        if (quantitativeSummary.teaching_cycle_analysis) { renderTeachingCycleChart(quantitativeSummary.teaching_cycle_analysis); }
        if (quantitativeSummary.speech_rate_trend_analysis) { renderSpeechRateChart(quantitativeSummary.speech_rate_trend_analysis); }
    }
    
    if (reportData.timeline_analysis && reportData.micro_event_summary && chartCanvas && chartContainer) {
        chartContainer.style.display = 'block';
        renderFocusMultiStateChart(chartCanvas, reportData.timeline_analysis, reportData.micro_event_summary);
    }
    
    // --- ★★★ 核心修改 4：確保在這裡為每張卡片添加 ID ★★★ ---
    if (timelineCardsContainer && reportData.timeline_analysis) {
        
        const timeToSeconds = (timeStr) => {
            if (!timeStr || typeof timeStr !== 'string') return null;
            const parts = timeStr.split(':').map(Number);
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            return null;
        };
        
        timelineCardsContainer.innerHTML = ''; // 清空舊卡片

        reportData.timeline_analysis.forEach(interval => {
            const card = document.createElement('div');
            card.className = 'timeline-card';
            
            // 【【【 在這裡為卡片賦予一個基於開始時間的唯一 ID 】】】
            card.id = `card-for-chunk-${interval.start_time.replace(/:/g, '_')}`;

            // ... (您後續生成卡片 innerHTML 的所有邏輯，完全保持不變) ...
            const focusAnalysis = interval.student_focus_analysis || {};
            const overallLevel = focusAnalysis.overall_level || '未知';
            const avgDist = focusAnalysis.average_distribution || {};
            const focusLevelClass = { '高': 'focus-high', '中高': 'focus-high', '中': 'focus-medium', '中偏高': 'focus-medium', '低': 'focus-low'}[overallLevel] || 'focus-unknown';

            let pacingHtml = '';
            if (interval.teaching_pacing_analysis) {
                const pacing = interval.teaching_pacing_analysis;
                pacingHtml = `<div class="pacing-analysis-section"><p><strong>教學節奏分析:</strong></p><div class="pacing-details"><span class="pacing-tag">認知負荷: ${escapeHtmlJs(pacing.cognitive_load_level || 'N/A')}</span><p>${escapeHtmlJs(pacing.analysis || '無分析')}</p></div></div>`;
            }

            let triggerHtml = '';
            if (interval.focus_trigger_analysis) {
                const posTrigger = interval.focus_trigger_analysis.positive_trigger;
                const negTrigger = interval.focus_trigger_analysis.negative_trigger;
                triggerHtml += '<div class="trigger-analysis-container">';
                
                if (posTrigger && posTrigger.trigger_snippet && posTrigger.trigger_snippet.key_quote) {
                    const snippet = posTrigger.trigger_snippet;
                    triggerHtml += `<div class="trigger-item positive-trigger"><span class="trigger-icon">🚀</span><div><p class="trigger-topic"><strong>提升點 (${escapeHtmlJs(snippet.topic || '')}):</strong></p><blockquote class="trigger-quote">${snippet.context_before ? `<span class="context-line">${escapeHtmlJs(snippet.context_before)}</span>` : ''}<strong class="key-line">${escapeHtmlJs(snippet.key_quote)}</strong>${snippet.context_after ? `<span class="context-line">${escapeHtmlJs(snippet.context_after)}</span>` : ''}</blockquote><p><em>分析: ${escapeHtmlJs(posTrigger.analysis)}</em></p></div></div>`;
                }

                if (negTrigger && negTrigger.trigger_snippet && negTrigger.trigger_snippet.key_quote) {
                    const snippet = negTrigger.trigger_snippet;
                    let impactHtml = ''; 
                    const intervalStartSecs = timeToSeconds(interval.start_time);
                    const intervalEndSecs = timeToSeconds(interval.end_time);
                    let impactData = null;

                    if (reportData.critical_segment_analysis && intervalStartSecs !== null && intervalEndSecs !== null) {
                        const matchingSegment = reportData.critical_segment_analysis.find(segment => {
                            const segmentStartSecs = timeToSeconds(segment.segment_start_time);
                            return segmentStartSecs !== null &&
                                   segmentStartSecs >= intervalStartSecs &&
                                   segmentStartSecs < intervalEndSecs &&
                                   segment.breaking_point_analysis && 
                                   segment.breaking_point_analysis.quantitative_impact;
                        });
                        
                        if (matchingSegment) {
                            impactData = matchingSegment.breaking_point_analysis.quantitative_impact;
                        }
                    }

                    if (impactData) {
                        const delta = impactData.change_delta_pct;
                        const isNegative = delta < 0;
                        const icon = isNegative ? '🔽' : '🔼';
                        const deltaClass = isNegative ? 'negative' : 'positive';
                        impactHtml = `<div class="quantitative-impact-display"><strong>${icon} 數據影響分析:</strong><span>${escapeHtmlJs(impactData.focus_metric_analyzed)} 從 <strong>${impactData.value_before_decline_pct.toFixed(1)}%</strong> 變為 <strong>${impactData.value_after_decline_pct.toFixed(1)}%</strong></span><span class="impact-delta ${deltaClass}">(${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)</span></div>`;
                    }
                    
                    triggerHtml += `
                        <div class="trigger-item negative-trigger">
                            <span class="trigger-icon">📉</span>
                            <div>
                                <p class="trigger-topic"><strong>下降點 (${escapeHtmlJs(snippet.topic || '')}):</strong></p>
                                <blockquote class="trigger-quote">
                                    ${snippet.context_before ? `<span class="context-line">${escapeHtmlJs(snippet.context_before)}</span>` : ''}
                                    <strong class="key-line">${escapeHtmlJs(snippet.key_quote)}</strong>
                                    ${snippet.context_after ? `<span class="context-line">${escapeHtmlJs(snippet.context_after)}</span>` : ''}
                                </blockquote>
                                <p><em>分析: ${escapeHtmlJs(negTrigger.analysis)}</em></p>
                                ${impactHtml} 
                            </div>
                        </div>`;
                }
                triggerHtml += '</div>';
            }
            
            const rawTask = avgDist.task_oriented_focus || 0;
            const rawReceptive = avgDist.receptive_engagement || 0;
            const rawDisengaged = avgDist.disengagement || 0;
            const total = rawTask + rawReceptive + rawDisengaged;
            const normTask = total > 0 ? (rawTask / total) * 100 : 0;
            const normReceptive = total > 0 ? (rawReceptive / total) * 100 : 0;
            const normDisengaged = total > 0 ? (rawDisengaged / total) * 100 : 0;

            card.innerHTML = `
                <div class="card-header">
                    <h5>時間區段: ${escapeHtmlJs(interval.start_time)} - ${escapeHtmlJs(interval.end_time)}</h5>
                    <span class="focus-tag ${focusLevelClass}">整體專注度: ${escapeHtmlJs(overallLevel)}</span>
                </div>
                <div class="card-body">
                    <p><strong>活動主題:</strong> ${escapeHtmlJs(interval.event_title || 'N/A')}</p>
                    <p><strong>教學內容:</strong> ${escapeHtmlJs(interval.event_description || 'N/A')}</p>
                    <div class="focus-distribution-bar">
                        <div class="bar-segment task-focus" style="width: ${normTask.toFixed(2)}%;" title="任務導向專注: ${normTask.toFixed(1)}%"></div>
                        <div class="bar-segment receptive-focus" style="width: ${normReceptive.toFixed(2)}%;" title="接收性專注: ${normReceptive.toFixed(1)}%"></div>
                        <div class="bar-segment disengaged" style="width: ${normDisengaged.toFixed(2)}%;" title="分心: ${normDisengaged.toFixed(1)}%"></div>
                    </div>
                    <div class="distribution-legend">
                        <span class="legend-item task-focus">任務導向 (${normTask.toFixed(1)}%)</span>
                        <span class="legend-item receptive-focus">接收性 (${normReceptive.toFixed(1)}%)</span>
                        <span class="legend-item disengaged">分心 (${normDisengaged.toFixed(1)}%)</span>
                    </div>
                    ${pacingHtml}
                    ${triggerHtml}
                    <p class="ai-insight"><strong>AI 洞察:</strong> ${escapeHtmlJs(interval.ai_insight || 'N/A')}</p>
                </div>
            `;
            timelineCardsContainer.appendChild(card);
        });
    }
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

function populateBehaviorSelector() {
    const container = document.getElementById('behaviorSelector');
    if (!container) return;

    for (const categoryName in BEHAVIOR_CATEGORIES_GROUPED) {
        const wrapper = container.querySelector(`.behavior-buttons-wrapper[data-category="${categoryName}"]`);
        if (!wrapper) continue;
        
        wrapper.innerHTML = '';
        const behaviors = BEHAVIOR_CATEGORIES_GROUPED[categoryName];
        
        behaviors.forEach(behaviorLabel => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'behavior-btn';
            button.textContent = behaviorLabel;
            button.dataset.value = behaviorLabel;

            // 【【【 全新 Toggle 互動邏輯 】】】
            button.onclick = function() {
                // 檢查當前按鈕是否已經是 active 狀態
                const isCurrentlyActive = this.classList.contains('active');

                // 無論如何，都先移除這個分類下所有按鈕的 active 狀態
                const buttonsInThisColumn = wrapper.querySelectorAll('.behavior-btn');
                buttonsInThisColumn.forEach(btn => btn.classList.remove('active'));

                // 如果剛才不是 active 狀態，那麼現在就把它設為 active
                // (實現了「選擇」和「切換選擇」的功能)
                if (!isCurrentlyActive) {
                    this.classList.add('active');
                }
                // 如果剛才就是 active 狀態，上面那一步已經把它移除了，這裡什麼都不做
                // (就實現了「取消選擇」的功能)
            };
            wrapper.appendChild(button);
        });
    }
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
        
        // --- 【【【 核心修改邏輯 】】】 ---
        
        // 1. 優先嘗試獲取精煉後的數據
        const refinedData = data.knowledge_hub_refined?.refined_knowledge_hub;
        
        // 2. 檢查精煉數據是否有效
        if (refinedData && Array.isArray(refinedData) && refinedData.length > 0) {
            console.log("偵測到有效的 'knowledge_hub_refined'，將渲染精煉版筆記。");
            renderKnowledgeHubForStudent(refinedData, hubContainer, reportDate);
        } 
        // 3. 如果精煉數據無效，則嘗試獲取初始數據
        else if (data.knowledge_hub_initial && typeof data.knowledge_hub_initial === 'object' && Object.keys(data.knowledge_hub_initial).length > 0) {
            console.log("未找到精煉數據，退回使用 'knowledge_hub_initial' 進行渲染。");
            // 將初始數據轉換為渲染函數可以接受的陣列格式
            const initialDataAsArray = Object.entries(data.knowledge_hub_initial).map(([topicName, topicData]) => {
                // 將多個教學片段的內容合併
                const combinedTranscript = topicData.teaching_segments
                    .map(segment => segment.relevant_transcript)
                    .join('\n\n---\n\n'); // 用分隔線合併不同時間段的內容
                
                // 收集所有不重複的圖片路徑
                const imageUrls = [...new Set(topicData.teaching_segments
                    .map(segment => segment.relevant_blackboard_image_path)
                    .filter(path => path) // 過濾掉 null 或空字串的路徑
                )];

                // 組合摘要
                const combinedSummary = topicData.teaching_segments
                    .map(segment => segment.summary_of_segment)
                    .join(' ');

                return {
                    main_topic: topicName,
                    topic_summary: combinedSummary,
                    refined_transcript_content: combinedTranscript,
                    relevant_blackboard_images: imageUrls
                };
            });
            // 使用轉換後的數據進行渲染
            renderKnowledgeHubForStudent(initialDataAsArray, hubContainer, reportDate);
        }
        // 4. 如果兩種數據都沒有
        else {
            const messageToShow = data.message || '暫無此日期的課堂筆記可供查看。';
            hubContainer.innerHTML = `<p class="text-center">${escapeHtml(messageToShow)}</p>`;
        }
        // --- 【【【 修改結束 】】】 ---

    } catch (error) {
        console.error(`獲取日期 ${reportDate} 的筆記時發生錯誤:`, error);
        hubContainer.innerHTML = `<p class="error-message" style="color: red; text-align: center;">無法加載課堂筆記: ${escapeHtml(error.message)}</p>`;
    }
}

/**
 * 【v2.0 - 保持不變】
 * 專門為學生報告頁面渲染知識庫的函數。
 * 此函數的邏輯不需要修改，因為我們已經在 populateKnowledgeHub 中將
 * `initial` 數據轉換成了它所期望的 `refined` 數據格式。
 * @param {Array} hubData - 包含所有主題的陣列
 * @param {HTMLElement} container - 要渲染內容的容器元素
 * @param {string} reportDate - 當前報告的日期 (格式 YYYY-MM-DD)，用於構建圖片URL
 */
function renderKnowledgeHubForStudent(hubData, container, reportDate) {
    container.innerHTML = ''; 

    if (!reportDate) {
        console.error("renderKnowledgeHubForStudent 錯誤: 未提供 reportDate，無法生成圖片路徑。");
    }

    hubData.forEach(topic => {
        const topicItem = document.createElement('div');
        topicItem.className = 'knowledge-topic-card';

        const button = document.createElement('button');
        button.className = 'accordion-button';
        button.innerHTML = `<h3>${escapeHtml(topic.main_topic)}</h3>`;
        
        const panel = document.createElement('div');
        panel.className = 'accordion-panel';

        // 這裡的 escapeHtml 應改為 escapeHtmlJs
        panel.innerHTML += `<div class="topic-section"><h4>AI 摘要</h4><p>${escapeHtmlJs(topic.topic_summary)}</p></div>`;
        panel.innerHTML += `<div class="topic-section"><h4>完整教學筆記</h4><div class="transcript-content">${escapeHtmlJs(topic.refined_transcript_content).replace(/\n/g, '<br>')}</div></div>`;

        if (topic.relevant_blackboard_images && topic.relevant_blackboard_images.length > 0) {
            let imagesHTML = '<div class="topic-section"><h4>相關板書快照</h4><div class="image-gallery">';
            topic.relevant_blackboard_images.forEach(imgPath => {
                const imageName = imgPath.split('\\').pop().split('/').pop();
                
                const imageUrl = `/api/student/get_note_image/${encodeURIComponent(reportDate)}/${encodeURIComponent(imageName)}`;
                
                imagesHTML += `
                    <div class="gallery-item">
                        <img src="${imageUrl}" alt="${escapeHtmlJs(imageName)}" loading="lazy" class="zoomable-image">
                        <p>${escapeHtmlJs(imageName)}</p>
                    </div>`;
            });
            imagesHTML += '</div></div>';
            panel.innerHTML += imagesHTML;
        }

        topicItem.appendChild(button);
        topicItem.appendChild(panel);
        container.appendChild(topicItem);
        
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
    
    // 修正：在 renderKnowledgeHubForStudent 中應該使用 escapeHtmlJs
    // 確保您的 js 檔案中有這個函數的定義
    function escapeHtmlJs(unsafe) {
        if (typeof unsafe !== 'string') {
            return unsafe === null || typeof unsafe === 'undefined' ? '' : String(unsafe);
        }
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
}

// 【【【 全新 v5.3 增強版 Tooltip 功能 】】】
function renderFocusMultiStateChart(canvas, detailedTimelineData, microEvents) {
    if (focusChartInstance) {
        focusChartInstance.destroy();
    }

    // --- 數據準備與正規化 (這部分邏輯不變) ---
    const labels = detailedTimelineData.map(d => d.start_time);
    const normalizedTaskData = [];
    const normalizedReceptiveData = [];
    const normalizedDisengagementData = [];

    detailedTimelineData.forEach(d => {
        const rawTask = d.student_focus_analysis?.average_distribution?.task_oriented_focus || 0;
        const rawReceptive = d.student_focus_analysis?.average_distribution?.receptive_engagement || 0;
        const rawDisengaged = d.student_focus_analysis?.average_distribution?.disengagement || 0;
        const total = rawTask + rawReceptive + rawDisengaged;
        if (total === 0) {
            normalizedTaskData.push(0);
            normalizedReceptiveData.push(0);
            normalizedDisengagementData.push(0);
        } else {
            normalizedTaskData.push((rawTask / total) * 100);
            normalizedReceptiveData.push((rawReceptive / total) * 100);
            normalizedDisengagementData.push((rawDisengaged / total) * 100);
        }
    });

    const data = {
        labels: labels,
        datasets: [
            {
                label: '任務導向專注',
                data: normalizedTaskData,
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                fill: true,
                tension: 0.2, 
                pointRadius: 0
            },
            {
                label: '接收性專注',
                data: normalizedReceptiveData,
                backgroundColor: 'rgba(255, 159, 64, 0.7)',
                borderColor: 'rgba(255, 159, 64, 1)',
                fill: true,
                tension: 0.2,
                pointRadius: 0
            },
            {
                label: '分心狀態',
                data: normalizedDisengagementData,
                backgroundColor: 'rgba(255, 99, 132, 0.7)',
                borderColor: 'rgba(255, 99, 132, 1)',
                fill: true,
                tension: 0.2,
                pointRadius: 0
            }
        ]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: false, // 標題已在 HTML 中，這裡不重複顯示
            },
            // ★★★ 核心修正 1：明確地為此圖表禁用 datalabels 插件 ★★★
            datalabels: {
                display: false
            },
            legend: {
                position: 'top',
                align: 'start' // 讓圖例靠左對齊，更美觀
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    title: (tooltipItems) => `時間區段: ${tooltipItems[0].label}`,
                    label: function(context) {
                         const label = context.dataset.label || '';
                         // ★★★ 核心修正 2：確保 tooltip 中的數字也格式化為一位小數 ★★★
                         const value = parseFloat(context.raw).toFixed(1);
                         return ` ${label}: ${value}%`;
                    },
                    afterBody: function(tooltipItems) {
                         const timeLabel = tooltipItems[0].label;
                         const microEvent = microEvents.find(e => e.time === timeLabel);
                         let details = [];
                         if (microEvent) {
                             details.push('');
                             let icon = '🔹';
                             if (microEvent.type.includes("高峰")) icon = '⭐';
                             if (microEvent.type.includes("低谷")) icon = '❗';
                             if (microEvent.type.includes("拉升")) icon = '🔼';
                             if (microEvent.type.includes("下跌")) icon = '🔽';
                             details.push(`${icon} [事件] ${microEvent.details}`);
                         }
                         if (microEvent && microEvent.teacher_speech_context) {
                            details.push('');
                            const speech = microEvent.teacher_speech_context.length > 60 
                                ? microEvent.teacher_speech_context.substring(0, 60) + '...' 
                                : microEvent.teacher_speech_context;
                            details.push(`🗣️ 老師話語: "${speech}"`);
                         }
                         return details;
                    }
                }
            }
        },
        scales: {
            x: { 
                title: { display: true, text: '課堂時間' }
            },
            y: { 
                stacked: true, 
                title: { display: true, text: '學生狀態比例 (%)' },
                min: 0,
                max: 100 
            }
        },
        interaction: { mode: 'index', intersect: false }
    };

    focusChartInstance = new Chart(canvas, {
        type: 'line',
        data: data,
        options: options
    });
}

// --- 【【【 新增的圖表渲染函數 】】】 ---

/**
 * 渲染教學模式分佈圓餅圖
 * @param {object} distributionData - 從 JSON 的 teaching_mode_distribution 來的數據
 */
function renderTeachingModeChart(distributionData) {
    const canvas = document.getElementById('teachingModeChart');
    if (!canvas) return;

    const labels = Object.keys(distributionData);
    const data = Object.values(distributionData).map(item => item.percentage_of_class);
    
    // 註冊我們在 HTML 中引入的 datalabels 插件
    Chart.register(ChartDataLabels);

    teachingModeChartInstance = new Chart(canvas, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)',
                    'rgba(54, 162, 235, 0.7)',
                    'rgba(255, 206, 86, 0.7)',
                    'rgba(75, 192, 192, 0.7)',
                    'rgba(153, 102, 255, 0.7)',
                ],
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                title: { display: false },
                // 設定 datalabels 插件
                datalabels: {
                    formatter: (value, ctx) => {
                        // 當百分比小於 5% 時不顯示，避免擁擠
                        if (value < 5) return null;
                        return value.toFixed(1) + '%';
                    },
                    color: '#fff',
                    font: {
                        weight: 'bold',
                        size: 14,
                    },
                    textStrokeColor: '#333',
                    textStrokeWidth: 2
                }
            }
        }
    });
}

/**
 * 渲染教學循環甘特圖 (使用水平長條圖模擬)
 * @param {object} cycleData - 從 JSON 的 teaching_cycle_analysis 來的數據
 */
function renderTeachingCycleChart(cycleData) {
    const canvas = document.getElementById('teachingCycleChart');
    if (!canvas || !cycleData.cycles || cycleData.cycles.length === 0) return;

    // 輔助函數：將 "H:MM:SS" 格式的時間轉為總秒數 (不變)
    const timeToSeconds = (timeStr) => {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return 0;
    };

    const labels = cycleData.cycles.map(c => `循環 ${c.cycle_index}`);
    
    // ★★★ 核心修正 1：為不同的教學模式定義顏色和標籤 ★★★
    const datasets = [{
        label: '高強度講解',
        data: cycleData.cycles.map(c => [timeToSeconds(c.start_time), timeToSeconds(c.start_time) + c.high_intensity_duration]),
        backgroundColor: 'rgba(255, 99, 132, 0.7)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
        borderSkipped: false
    }, {
        label: '標準互動/緩衝',
        data: cycleData.cycles.map(c => [timeToSeconds(c.start_time) + c.high_intensity_duration, timeToSeconds(c.end_time)]),
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        borderSkipped: false
    }];

    // 銷毀舊圖表實例
    if (teachingCycleChartInstance) {
        teachingCycleChartInstance.destroy();
    }

    teachingCycleChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                title: { display: false },
                datalabels: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const start = context.raw[0];
                            const end = context.raw[1];
                            const duration = end - start;
                            const minutes = Math.floor(duration / 60);
                            const seconds = duration % 60;
                            return `${context.dataset.label}: ${minutes}分 ${seconds}秒`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '課堂時間 (時:分:秒)' // 修改標題文字
                    },
                    // ★★★ 核心修正 2：優化 X 軸刻度顯示 ★★★
                    ticks: {
                        // 讓 Chart.js 自動計算最佳刻度數量，避免重疊
                        autoSkip: true,
                        maxTicksLimit: 8, // 最多顯示 8 個主要刻度
                        // 將 X 軸的刻度標籤格式化為 HH:MM:SS
                        callback: function(value) {
                            // 將秒數轉換回 HH:MM:SS 格式
                            return new Date(value * 1000).toISOString().substr(11, 8);
                        }
                    }
                },
                y: {
                    stacked: true
                }
            }
        }
    });
}


/**
 * 渲染語速趨勢長條圖及統計數據
 * @param {object} trendData - 從 JSON 的 speech_rate_trend_analysis 來的數據
 */
function renderSpeechRateChart(trendData) {
    const canvas = document.getElementById('speechRateChart');
    const statsDiv = document.getElementById('speechRateStats');
    if (!canvas || !statsDiv || !trendData.comparative_summary) return;

    const comp = trendData.comparative_summary;
    const labels = ['上半場平均語速', '下半場平均語速'];
    const data = [comp.average_wpm_first_half, comp.average_wpm_second_half];

    speechRateChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '平均每分鐘字數 (wpm)',
                data: data,
                backgroundColor: ['rgba(255, 159, 64, 0.7)', 'rgba(75, 192, 192, 0.7)'],
                borderColor: ['rgba(255, 159, 64, 1)', 'rgba(75, 192, 192, 1)'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }, // 只有一個數據集，不用圖例
                title: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: '每分鐘字數 (wpm)'
                    }
                }
            }
        }
    });

    // 填充統計數據
    const stats = trendData.linear_regression_stats;
    statsDiv.innerHTML = `
        <p><strong>整體趨勢:</strong> ${escapeHtmlJs(trendData.trend_description || 'N/A')}</p>
        <p><strong>變化率:</strong> ${escapeHtmlJs(comp.change_percentage.toFixed(2))}%</p>
        <p><strong>線性回歸斜率:</strong> ${escapeHtmlJs(stats.slope_per_minute.toFixed(2))} wpm/分鐘</p>
        <p><strong>R² (決定係數):</strong> ${escapeHtmlJs(stats.r_squared.toFixed(4))}</p>
    `;
}