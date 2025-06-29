// static/js/teacher_dashboard.js

document.addEventListener('DOMContentLoaded', function() {
    const activityTableBody = document.getElementById('studentsActivityTableBody');
    
    if (!activityTableBody) {
        console.error("Element with ID 'studentsActivityTableBody' not found.");
        // 可以在頁面上顯示一個更友好的錯誤提示
        const container = document.querySelector('.dashboard-container');
        if(container) container.innerHTML = '<p style="color:red; text-align:center;">儀表板表格加載失敗，請聯繫管理員。</p>';
        return;
    }

    // 假設 logUserClick 函數在 main.js 中定義且已加載
    if (typeof logUserClick === 'function') {
        logUserClick('view_teacher_dashboard_page_js_students_summary');
    }

    fetch('/api/teacher/all_students_activity_summary')
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { // 嘗試解析後端返回的JSON錯誤信息
                    throw new Error(`HTTP error! status: ${response.status}, message: ${err.error || '無法獲取學生摘要'}`);
                }).catch(() => { // 如果後端錯誤不是JSON格式
                    throw new Error(`HTTP error! status: ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) { // 處理API返回的業務邏輯錯誤
                throw new Error(data.error);
            }
            populateStudentsActivityTable(data, activityTableBody);
        })
        .catch(error => {
            console.error('獲取學生行為摘要失敗:', error);
            activityTableBody.innerHTML = `<tr><td colspan="4" style="color:red;text-align:center;">無法加載學生行為摘要: ${escapeHtmlJs(error.message)}</td></tr>`;
        });
});

function populateStudentsActivityTable(summaryData, tableBody) {
    tableBody.innerHTML = ''; // 清空 "正在加載..." 或舊數據

    if (summaryData && summaryData.length > 0) {
        summaryData.forEach(student => {
            const row = tableBody.insertRow();
            
            row.insertCell().textContent = student.student_name || student.student_id;
            row.insertCell().textContent = student.total_clicks;
            row.insertCell().textContent = student.time_on_student_report_page_formatted || 'N/A';
            
            const actionsCell = row.insertCell();
            // 示例：添加一個查看該學生詳細日誌的按鈕 (需要後端支持)
            // const viewLogButton = document.createElement('button');
            // viewLogButton.textContent = '查看詳細點擊';
            // viewLogButton.className = 'action-button'; // 可以添加CSS class
            // viewLogButton.onclick = function() {
            //     logUserClick(`button_view_student_log_${student.student_id}`);
            //     // window.location.href = `/teacher/student_log/${student.student_id}`; // 跳轉到新頁面
            //     alert(`查看學生 ${student.student_id} 的詳細日誌 (功能待實現)`);
            // };
            // actionsCell.appendChild(viewLogButton);
            actionsCell.textContent = 'N/A'; // 暫時的佔位符
        });
    } else {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">暫無學生行為數據可供顯示。</td></tr>';
    }
}

// 確保 escapeHtmlJs 函數已定義 (如果 main.js 中沒有，可以在此處定義)
// 或者如果您在 layout.html 全局引入了包含 escapeHtml 的 main.js，這裡就不需要了
function escapeHtmlJs(unsafe) { // 重命名以避免與可能存在的全局 escapeHtml 衝突
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