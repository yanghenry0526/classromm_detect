// static/js/register_validation.js (如果創建新文件)
document.addEventListener('DOMContentLoaded', function() {
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', function(event) {
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');
            const confirmPasswordInput = document.getElementById('confirm_password');
            let isValid = true;
            let errorMessage = "";

            // 清除之前的錯誤提示 (如果有的話)
            clearErrorMessages(this);

            if (usernameInput.value.trim() === '') {
                displayErrorMessage(usernameInput, '學生姓名不能為空。');
                isValid = false;
            }
            // 可以添加中文用戶名長度或其他格式驗證
            // 例如： if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]{2,10}$/.test(usernameInput.value.trim())) { ... }

            if (passwordInput.value.length < 6) { // 示例：密碼至少6位
                displayErrorMessage(passwordInput, '密碼長度至少需要6位。');
                isValid = false;
            }

            if (confirmPasswordInput.value !== passwordInput.value) {
                displayErrorMessage(confirmPasswordInput, '兩次輸入的密碼不一致。');
                isValid = false;
            }

            if (!isValid) {
                event.preventDefault(); // 阻止表單提交
                // 可以將所有錯誤信息匯總顯示在一個地方
                // const formErrorContainer = document.getElementById('formErrorMessages');
                // if(formErrorContainer) formErrorContainer.textContent = "請修正表單中的錯誤。";
            } else {
                // 如果客戶端驗證通過，可以顯示一個 "處理中..." 的提示
                const submitButton = this.querySelector('button[type="submit"]');
                if(submitButton) {
                    submitButton.disabled = true;
                    submitButton.textContent = '註冊中...';
                }
            }
        });
    }
});

function displayErrorMessage(inputElement, message) {
    // 在輸入框下方顯示錯誤信息
    const errorSpan = document.createElement('span');
    errorSpan.className = 'input-error-message'; // 需要CSS樣式
    errorSpan.style.color = 'red';
    errorSpan.style.fontSize = '0.9em';
    errorSpan.style.display = 'block';
    errorSpan.textContent = message;
    inputElement.parentNode.appendChild(errorSpan); // 添加到父節點
    inputElement.classList.add('input-error'); // 給輸入框添加錯誤樣式
}

function clearErrorMessages(formElement) {
    formElement.querySelectorAll('.input-error-message').forEach(span => span.remove());
    formElement.querySelectorAll('.input-error').forEach(input => input.classList.remove('input-error'));
    // const formErrorContainer = document.getElementById('formErrorMessages');
    // if(formErrorContainer) formErrorContainer.textContent = "";
}