// static/js/teacher_dashboard.js (全新版本)

// --- 全局變量 ---
let allStudentData = []; // 用於緩存從API獲取的所有學生數據

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
        const behaviorStats = reportSummary.behavior_statistics || [];

        let studentHtml = `<h4>${escapeHtmlJs(student.student_name)} (報告日期: ${escapeHtmlJs(reportSummary.report_date || 'N/A')})</h4>`;

        if (behaviorStats.length > 0) {
            studentHtml += `
                <div class="table-responsive-wrapper">
                    <table class="dashboard-table compact-table">
                        <thead><tr><th>行為類別</th><th>百分比</th><th>次數</th></tr></thead>
                        <tbody>
            `;
            // 這裡已經由後端排序，直接渲染即可
            behaviorStats.forEach(stat => {
                studentHtml += `
                    <tr>
                        <td>${escapeHtmlJs(stat.behavior_category)}</td>
                        <td>${stat.percentage}%</td>
                        <td>${stat.count}</td>
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

// 頁簽3：渲染行為影像瀏覽器
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

        const behaviorIndex = student.report_summary?.behavior_to_images_index;
        if (behaviorIndex && Object.keys(behaviorIndex).length > 0) {
            const list = document.createElement('ul');
            list.className = 'behavior-list';
            for (const [behavior, images] of Object.entries(behaviorIndex)) {
                if (images.length > 0) {
                    const listItem = document.createElement('li');
                    listItem.className = 'behavior-item';
                    listItem.textContent = `${escapeHtmlJs(behavior)} (${images.length} 張)`;
                    listItem.dataset.studentName = student.student_name;
                    listItem.dataset.behavior = behavior;
                    listItem.dataset.images = JSON.stringify(images); // 將圖片列表存儲在data屬性中
                    listItem.dataset.reportFilename = student.report_summary.latest_report_filename; // 假設後端會提供這個
                    listItem.onclick = () => showImageModal(listItem.dataset);
                    list.appendChild(listItem);
                }
            }
            panel.appendChild(list);
        } else {
            panel.innerHTML = '<p>無可用的行為影像索引。</p>';
        }

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
        const selectedDate = dateSelector.value;
        let apiUrl = '/api/teacher/all_students_activity_summary';
        if (selectedDate) {
            apiUrl += `?date=${selectedDate}`;
        }

        loadingMessage.style.display = 'block';
        loadingMessage.textContent = `正在查詢 ${selectedDate || '最新'} 的報告數據...`;
        errorMessage.style.display = 'none';
        tabContents.forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));


        fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw new Error(err.error || '伺服器響應錯誤'); });
                }
                return response.json();
            })
            .then(data => {
                if (data.error) { throw new Error(data.error); }
                
                allStudentData = data;
                renderAllTabs(allStudentData);

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
    function renderAllTabs(data) {
        populateWebActivityTab(data);
        populateBehaviorStatsTab(data);
        populateImageExplorerTab(data);
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