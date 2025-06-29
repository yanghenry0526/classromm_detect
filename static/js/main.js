// 全局函數，用於記錄用戶點擊
function logUserClick(elementName) {
    // 檢查用戶是否登入，可以通過檢查頁面某個元素或全局變量
    // 為了簡化，我們假設如果能調用此函數，用戶已通過Flask的 @login_required
    fetch('/api/log_click', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Flask-WTF CSRF token (如果啟用)
            // 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
        },
        body: JSON.stringify({ element: elementName }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Click logged:', elementName);
        } else {
            console.error('Failed to log click:', data.message);
        }
    })
    .catch(error => {
        console.error('Error logging click:', error);
    });
}

// 可以在這裡添加其他全局JS邏輯，例如頁眉的動態交互等
document.addEventListener('DOMContentLoaded', function() {
    console.log('Main JavaScript loaded.');
    // 示例：為所有帶有 data-log-click 屬性的按鈕添加點擊日誌
    document.querySelectorAll('[data-log-click]').forEach(button => {
        button.addEventListener('click', function() {
            logUserClick(this.dataset.logClick);
        });
    });
});