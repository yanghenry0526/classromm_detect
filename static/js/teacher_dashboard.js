// static/js/teacher_dashboard.js (全新版本)

// --- 全局變量 ---
let allStudentData = []; // 用於緩存從API獲取的所有學生數據

const ALL_BEHAVIOR_CATEGORIES = [
    "主動舉手",
    "被動舉手",
    "做筆記",
    "喝水",
    "飲食",
    "坐姿直立",
    "托腮",
    "玩弄手部/文具",
    "目視他處",
    "目視同學",
    "目視教師",
    "目視書本/筆記",
    "目視黑板",
    "被遮擋/無法判斷",
    "觸摸臉部",
    "觸摸頭髮",
    "身體前傾",
    "身體後靠",
    "低頭(非學習)",
    "趴睡"
    // 請確保這裡的中文名稱與您 JSON 報告中可能出現的所有 behavior_category 完全一致
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
        const behaviorIndex = reportSummary.behavior_to_images_index || {}; // 安全地獲取物件

        // 即使沒有任何影像索引，我們依然要創建列表結構
        const list = document.createElement('ul');
        list.className = 'behavior-list';

        // ★★★ 核心邏輯修改：遍歷我們在頂部定義的完整行為列表 ★★★
        ALL_BEHAVIOR_CATEGORIES.forEach(categoryName => {
            // 從後端數據中查找該行為對應的圖片數組
            const images = behaviorIndex[categoryName] || []; // 如果找不到，就用一個空數組
            
            const listItem = document.createElement('li');
            listItem.className = 'behavior-item';
            listItem.textContent = `${escapeHtmlJs(categoryName)} (${images.length} 張)`;

            // 只有當圖片數量大於0時，才讓它可以點擊
            if (images.length > 0) {
                listItem.classList.add('clickable'); // 添加一個 class 以便美化樣式 (可選)
                listItem.dataset.studentName = student.student_name;
                listItem.dataset.behavior = categoryName;
                listItem.dataset.images = JSON.stringify(images);
                listItem.dataset.reportFilename = reportSummary.latest_report_filename;
                listItem.onclick = () => showImageModal(listItem.dataset);
            } else {
                listItem.classList.add('disabled'); // 圖片數為0的項目設為不可點擊樣式 (可選)
            }
            
            list.appendChild(listItem);
        });

        panel.appendChild(list);

        accordionBtn.onclick = function() {
            this.classList.toggle("active");
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            } 
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
        
        // 這裡我們直接創建一個“點擊查看”的按鈕，而不是列表
        const viewButton = document.createElement('button');
        viewButton.textContent = '點擊查看所有影像';
        viewButton.className = 'view-images-button';
        // 將所有需要的數據綁定到按鈕上
        viewButton.dataset.behavior = behavior;
        viewButton.dataset.imagesInfo = JSON.stringify(imagesWithInfo); // 包含學生、報告和圖片名的完整列表
        
        viewButton.onclick = () => showCrossStudentImageModal(viewButton.dataset);

        panel.appendChild(viewButton);

        accordionBtn.onclick = function() {
            this.classList.toggle("active");
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            } 
        };
        
        behaviorDiv.appendChild(accordionBtn);
        behaviorDiv.appendChild(panel);
        accordionContainer.appendChild(behaviorDiv);
    }
    container.appendChild(accordionContainer);
}

// --- Modal 彈出視窗邏輯 ---
function showImageModal(dataset) {
    const modal = document.getElementById("imageModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalImageGrid = document.getElementById("modalImageGrid");
    
    const { studentName, behavior, images, reportFilename } = dataset;
    
    if (!reportFilename) {
        alert("錯誤：找不到報告檔名，無法加載圖片。請確認後端API是否正確回傳 'latest_report_filename'。");
        return;
    }
    
    modalTitle.textContent = `學生: ${escapeHtmlJs(studentName)} - 行為: ${escapeHtmlJs(behavior)}`;
    modalImageGrid.innerHTML = '<p class="text-center">正在加載圖片...</p>';
    modal.style.display = "block";
    
    const imageArray = JSON.parse(images);
    modalImageGrid.innerHTML = ''; // 清空

    imageArray.forEach(imageFile => {
        const imgContainer = document.createElement('div');
        const img = document.createElement('img');
        
        const imgSrc = `/api/get_sequence_image?report_file=${encodeURIComponent(reportFilename)}&image_file=${encodeURIComponent(imageFile)}`;
        
        img.src = imgSrc;
        img.alt = imageFile;
        img.title = imageFile; // 添加 title 屬性，滑鼠懸停時顯示檔名
        img.className = 'modal-image';
        img.loading = 'lazy';
        
        imgContainer.appendChild(img);
        modalImageGrid.appendChild(imgContainer);
    });
}

function showCrossStudentImageModal(dataset) {
    const modal = document.getElementById("imageModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalImageGrid = document.getElementById("modalImageGrid");
    
    const { behavior, imagesInfo } = dataset;
    
    modalTitle.textContent = `行為總覽: ${escapeHtmlJs(behavior)}`;
    modalImageGrid.innerHTML = '<p class="text-center">正在加載圖片...</p>';
    modal.style.display = "block";
    
    const imageInfoArray = JSON.parse(imagesInfo);
    modalImageGrid.innerHTML = ''; // 清空

    imageInfoArray.forEach(info => {
        const imgContainer = document.createElement('div');
        imgContainer.className = 'modal-image-container-with-label'; // 給容器一個class以便添加樣式

        const img = document.createElement('img');
        const imgSrc = `/api/get_sequence_image?report_file=${encodeURIComponent(info.report_filename)}&image_file=${encodeURIComponent(info.image_filename)}`;
        
        img.src = imgSrc;
        img.alt = `${info.student_name} - ${info.image_filename}`;
        img.title = `${info.student_name} - ${info.image_filename}`;
        img.className = 'modal-image';
        img.loading = 'lazy';

        // 創建一個標籤來顯示學生姓名
        const label = document.createElement('div');
        label.className = 'image-label';
        label.textContent = escapeHtmlJs(info.student_name);
        
        imgContainer.appendChild(img);
        imgContainer.appendChild(label); // 將圖片和標籤都放入容器
        modalImageGrid.appendChild(imgContainer);
    });
}

// --- 主邏輯：頁面加載完成後執行 ---
document.addEventListener('DOMContentLoaded', function() {
    // --- 獲取所有需要的DOM元素 ---
    const dateSelector = document.getElementById('dateSelector');
    const loadReportButton = document.getElementById('loadReportButton');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessage = document.getElementById('errorMessage');
    const tabContents = document.querySelectorAll('.tab-content');
    const modal = document.getElementById("imageModal");
    const closeBtn = document.querySelector(".modal .close-button");

    // --- 初始化頁面 ---
    function initializePage() {
        tabContents.forEach(tab => tab.style.display = 'none');
        loadReportButton.disabled = true;
        fetchAvailableDates();
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
                    const latestOption = document.createElement('option');
                    latestOption.value = ""; // 空值代表查詢最新
                    latestOption.textContent = "載入最新報告";
                    dateSelector.appendChild(latestOption);
                    
                    dates.forEach(date => {
                        const option = document.createElement('option');
                        option.value = date;
                        option.textContent = date;
                        dateSelector.appendChild(option);
                    });
                    loadReportButton.disabled = false;
                    loadReportData(); // 默認觸發一次查詢，加載最新報告
                } else {
                    dateSelector.innerHTML = '<option value="">無可用報告日期</option>';
                    loadingMessage.textContent = '系統中尚無任何報告。';
                }
            })
            .catch(handleError);
    }
    
    // --- API 呼叫：根據日期獲取學生摘要數據 ---
    function loadReportData() {
        // 【修改前】
        // const selectedDate = dateSelector.value || dateSelector.options[0].value; 
        
        // 【修改後】的邏輯
        let selectedDate = dateSelector.value;
        // 如果選中的是"載入最新報告"(其value為"")，並且下拉選單中確實有其他日期選項
        if (selectedDate === "" && dateSelector.options.length > 1) {
            // 就自動選取第二個選項的值，因為第一個是"載入最新報告"，第二個才是最新的日期
            selectedDate = dateSelector.options[1].value;
        }

        // 現在，如果 selectedDate 仍然是空的，那才代表真的沒有日期可以查詢
        if (!selectedDate) {
            handleError(new Error("沒有可供查詢的報告日期。"));
            return;
        }

        let summaryApiUrl = `/api/teacher/all_students_activity_summary?date=${selectedDate}`;
        let behaviorApiUrl = `/api/teacher/behavior_summary_by_date?date=${selectedDate}`;

        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在查詢 ${selectedDate} 的報告數據...`;
        errorMessage.style.display = 'none';
        tabContents.forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        // 使用 Promise.all 並行獲取兩種數據
        Promise.all([
            fetch(summaryApiUrl).then(res => res.json()),
            fetch(behaviorApiUrl).then(res => res.json())
        ])
        .then(([summaryData, behaviorData]) => {
            // 檢查兩個請求是否都成功
            if (summaryData.error) { throw new Error(summaryData.error); }
            if (behaviorData.error) { throw new Error(behaviorData.error); }
            
            allStudentData = summaryData; // 緩存學生為單位的數據
            
            // 渲染所有標籤頁
            renderAllTabs(summaryData, behaviorData);

            loadingMessage.style.display = 'none';
            // 默認顯示第一個標籤頁
            const firstTab = document.getElementById('webActivityTab');
            if (firstTab) firstTab.style.display = 'block';
            const firstTabButton = document.querySelector('.tab-button');
            if (firstTabButton) firstTabButton.classList.add('active');
        })
        .catch(handleError);
    }

    // --- 統一的錯誤處理函數 ---
    function handleError(error) {
        console.error('操作失敗:', error);
        loadingMessage.style.display = 'none';
        errorMessage.textContent = `錯誤: ${escapeHtmlJs(error.message)}`;
        errorMessage.style.display = 'block';
    }

    // --- 數據渲染主函數 ---
    function renderAllTabs(summaryData, behaviorData) {
        populateWebActivityTab(summaryData);
        populateBehaviorStatsTab(summaryData);
        populateImageExplorerTab(summaryData);
        populateCrossStudentTab(behaviorData);
    }

    // --- 事件監聽 ---
    loadReportButton.addEventListener('click', loadReportData);
    
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = "none";
    }
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };

    // --- 啟動頁面 ---
    initializePage();
});

// 將 openTeacherTab 設為全局可訪問，因為它是從 HTML 的 onclick 屬性中調用的
window.openTeacherTab = openTeacherTab;