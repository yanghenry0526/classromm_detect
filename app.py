import os
import json
import datetime
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, flash , send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import glob
import re
import base64 

# --- App Configuration ---
app = Flask(__name__, instance_relative_config=True)
app.config['SECRET_KEY'] = os.urandom(24) # 在生產環境中，應使用更安全的固定密鑰管理方式
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///site.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['BEHAVIOR_REPORT_FOLDER'] = os.path.join(app.root_path, 'SynologyDrive\json_behavior')
app.config['STUDENT_WEEK_PHOTO_FOLDER'] = r'C:\Users\User\Desktop\test\student_week_photo'
app.config['NOTES_REPORT_FOLDER'] = r'C:\Users\User\Desktop\test\note_json'
app.config['NOTES_BLACKBOARD_FOLDER'] = r'C:\Users\User\Desktop\test\note_blackboard'
app.config['TRAINING_JSON_FOLDER'] = r'C:\Users\User\Desktop\test\training_json'
app.config['FEW_SHOT_EXAMPLES_FILENAME'] = 'few_shot_examples.json'

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'
login_manager.login_message = "請先登入以訪問此頁面。"
login_manager.login_message_category = "info"

# --- Database Models ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False) # 用戶名/學生姓名，考慮長度
    password_hash = db.Column(db.String(128), nullable=False)
    role = db.Column(db.String(10), nullable=False) # 'student' or 'teacher'
    clicks = db.relationship('ClickLog', backref='user_clicked', lazy='dynamic') # 改為 dynamic 以便後續 count()

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"User('{self.username}', '{self.role}')"

# app.py (ClickLog 模型)
class ClickLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    event_type = db.Column(db.String(50), nullable=False, default='click') 
    # 新增: 'click', 'tab_view_start', 'tab_view_end'
    element_or_page_id = db.Column(db.String(100), nullable=False) # 記錄點擊的元素或查看的標籤頁ID
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    duration_seconds = db.Column(db.Integer, nullable=True) # 新增: 記錄停留時長 (秒)

    def __repr__(self):
        return f"Log(User ID '{self.user_id}', Type '{self.event_type}', Target '{self.element_or_page_id}', Duration '{self.duration_seconds}')"
    
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- Helper Functions for Activity Summary ---
def calculate_time_on_page(student_user_id, page_entry_element_pattern, session_timeout_seconds=1800): # 30分鐘超時
    logs = ClickLog.query.filter_by(user_id=student_user_id).order_by(ClickLog.timestamp).all()
    
    total_duration_seconds = 0
    page_session_start_time = None
    last_activity_time_in_session = None

    for i, log_entry in enumerate(logs):
        is_page_entry = page_entry_element_pattern in log_entry.element_clicked

        if page_session_start_time is not None:
            # 如果當前日誌與上一日誌時間間隔超過超時，則結束上一個頁面會話
            time_diff_from_last = (log_entry.timestamp - last_activity_time_in_session).total_seconds()
            if time_diff_from_last >= session_timeout_seconds:
                duration_this_segment = (last_activity_time_in_session - page_session_start_time).total_seconds()
                total_duration_seconds += min(duration_this_segment, session_timeout_seconds) # 計入但不超過超時
                page_session_start_time = None # 重置
        
        if is_page_entry:
            if page_session_start_time is not None : # 如果是連續進入同一個頁面 (例如刷新)
                 # 結束上一個停留段 (從上個 page_entry 到現在)
                duration_this_segment = (log_entry.timestamp - page_session_start_time).total_seconds()
                total_duration_seconds += min(duration_this_segment, session_timeout_seconds)

            page_session_start_time = log_entry.timestamp # 開始新的停留段
        
        if page_session_start_time is not None: # 只要在頁面會話中，就更新最後活動時間
            last_activity_time_in_session = log_entry.timestamp

    # 處理最後一段停留時間
    if page_session_start_time and last_activity_time_in_session:
        duration_last_segment = (last_activity_time_in_session - page_session_start_time).total_seconds()
        total_duration_seconds += min(duration_last_segment, session_timeout_seconds)
        
    return total_duration_seconds

def format_seconds_to_readable(total_seconds_float):
    total_seconds = int(total_seconds_float) # 確保是整數
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours > 0:
        return f"{hours}小時 {minutes}分 {seconds}秒"
    elif minutes > 0:
        return f"{minutes}分 {seconds}秒"
    else:
        return f"{seconds}秒"

# --- Routes ---
@app.route('/')
def index():
    if current_user.is_authenticated:
        if current_user.role == 'student':
            return redirect(url_for('student_report_page'))
        elif current_user.role == 'teacher':
            return redirect(url_for('teacher_dashboard_page'))
    return redirect(url_for('login_page'))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=True)
            flash(f'歡迎回來, {user.username}!', 'success')
            if user.role == 'student':
                return redirect(url_for('student_report_page'))
            elif user.role == 'teacher':
                return redirect(url_for('teacher_dashboard_page'))
        else:
            flash('帳號或密碼錯誤，請重試。', 'error')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register_page():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')

        if not username or not password or not confirm_password:
            flash('所有欄位都必須填寫。', 'error')
            return redirect(url_for('register_page'))
        if len(password) < 3: # 簡單的密碼長度驗證
            flash('密碼長度至少需要3位。', 'error')
            return redirect(url_for('register_page'))
        if password != confirm_password:
            flash('兩次輸入的密碼不一致。', 'error')
            return redirect(url_for('register_page'))
        
        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            flash(f'學生姓名 "{username}" 已經被註冊過了，請使用其他名稱。', 'error')
            return redirect(url_for('register_page'))
            
        new_user = User(username=username, role='student')
        new_user.set_password(password)
        
        try:
            db.session.add(new_user)
            db.session.commit()
            flash(f'學生帳號 "{username}" 註冊成功！現在您可以登入了。', 'success')
            return redirect(url_for('login_page'))
        except Exception as e:
            db.session.rollback()
            flash(f'註冊過程中發生錯誤，請稍後再試。', 'error') # 避免直接暴露錯誤細節給前端
            print(f"註冊錯誤: {e}")
            return redirect(url_for('register_page'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('您已成功登出。', 'info')
    return redirect(url_for('login_page'))

@app.route('/student/report')
@login_required
def student_report_page():
    if current_user.role != 'student':
        flash('權限不足，無法訪問此頁面。', 'warning')
        return redirect(url_for('index'))
    return render_template('student_report.html')

@app.route('/teacher/dashboard')
@login_required
def teacher_dashboard_page():
    if current_user.role != 'teacher':
        flash('權限不足，無法訪問此頁面。', 'warning')
        return redirect(url_for('index'))
    return render_template('teacher_dashboard.html')

# --- API Routes ---

@app.route('/api/student/get_note_report_for_date', methods=['GET'])
@login_required
def api_get_note_report_for_date():
    """
    根據日期獲取對應的課堂筆記報告。
    """
    if current_user.role != 'student':
        return jsonify({"error": "權限不足"}), 403

    # 從前端請求中獲取日期字符串，例如 '2025-07-06'
    report_date_str = request.args.get('date')
    if not report_date_str:
        return jsonify({'error': '未提供日期參數'}), 400

    notes_folder = app.config['NOTES_REPORT_FOLDER']
    if not os.path.isdir(notes_folder):
        return jsonify({'error': f"伺服器錯誤：找不到筆記資料夾"}), 500

    try:
        # 將 '2025-07-06' 轉換為檔名中使用的 '0706' 格式
        # 這裡假設年份不是關鍵，只用月和日來匹配
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_suffix_for_filename = date_obj.strftime('%m%d') # -> "0706"

        # 構建模糊搜尋的檔案模式
        # 例如: knowledge_hub_英文_0706_final.json
        file_pattern = os.path.join(notes_folder, f"*_{date_suffix_for_filename}_final.json")
        
        matching_files = glob.glob(file_pattern)

        if not matching_files:
            # 如果找不到，返回一個清晰的訊息，而不是錯誤
            return jsonify({
                "message": "暫無此日期的課堂筆記可供查看。",
                "knowledge_hub_refined": None # 確保前端能處理這個情況
            }), 200

        # 假設每天只有一份報告，直接取第一份找到的
        latest_note_path = matching_files[0]
        
        with open(latest_note_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return jsonify(data)

    except Exception as e:
        print(f"為學生 {current_user.username} 獲取日期 {report_date_str} 的筆記時出錯: {e}")
        return jsonify({"error": "伺服器在獲取課堂筆記時發生錯誤"}), 500

# 【新增一個給學生筆記用的圖片API】
# 為了安全，最好分開，雖然邏輯一樣
@app.route('/api/student/get_note_image/<date_str>/<filename>') # 新增 <date_str>
@login_required
def api_student_get_note_image(date_str, filename): # 新增 date_str 參數
    """安全地為學生提供筆記中的板書圖片，路徑根據日期動態決定。"""
    if current_user.role != 'student':
        return jsonify({"error": "權限不足"}), 403

    # --- 步驟 1: 安全性檢查 ---
    # 檢查檔名
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({'error': '無效的檔案名稱'}), 400
    # 檢查日期格式 (例如: 2025-07-06)，防止惡意輸入
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return jsonify({'error': '無效的日期格式'}), 400

    try:
        # --- 步驟 2: 動態構建資料夾路徑 ---
        base_folder = app.config['NOTES_BLACKBOARD_FOLDER']
        
        # 將 "2025-07-06" 轉換為 "0706"，用於匹配資料夾名稱
        date_obj = datetime.datetime.strptime(date_str, '%Y-%m-%d')
        date_prefix_for_folder = date_obj.strftime('%m%d') # -> "0706"

        # 使用 glob 模糊查找以該日期開頭的資料夾，例如 '0706_English_filtered'
        # 這比寫死名稱更有彈性
        search_pattern = os.path.join(base_folder, f"{date_prefix_for_folder}_*")
        matching_folders = glob.glob(search_pattern)

        if not matching_folders:
            print(f"警告：在 {base_folder} 中未找到符合 '{date_prefix_for_folder}_*' 模式的資料夾")
            return jsonify({'error': '找不到對應日期的圖片資料夾'}), 404
        
        # 假設每天只有一個對應資料夾，取第一個找到的
        target_folder = matching_folders[0]
        
        # 組合最終的圖片完整路徑
        image_path = os.path.join(target_folder, filename)
        
        print(f"動態圖片請求: 日期='{date_str}', 檔案='{filename}', 最終路徑='{image_path}'")

        # --- 步驟 3: 回傳圖片 ---
        if os.path.isfile(image_path):
            return send_file(image_path)
        else:
            print(f"警告：學生請求的圖片未找到: {image_path}")
            return jsonify({'error': '圖片未找到'}), 404
            
    except Exception as e:
        print(f"獲取動態筆記圖片時發生錯誤: {e}")
        return jsonify({'error': '伺服器內部錯誤'}), 500


@app.route('/api/student/reports_list', methods=['GET'])
@login_required
def api_get_student_reports_list():
    # 權限檢查
    if current_user.role != 'student':
        return jsonify({'error': '權限不足'}), 403

    try:
        student_id = current_user.username
        student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student_id)
        
        # 檢查學生報告資料夾是否存在
        if not os.path.isdir(student_report_folder):
            print(f"API Warning: 未找到學生 {student_id} 的報告文件夾: {student_report_folder}")
            return jsonify([]), 200

        reports_info = []
        file_pattern = os.path.join(student_report_folder, f"student_{student_id}_behavior_report_*.json")
        matching_files = glob.glob(file_pattern)

        print(f"API Info: 正在為學生 '{student_id}' 查找報告，找到 {len(matching_files)} 個匹配文件。")

        for f_path in matching_files:
            filename = os.path.basename(f_path)
            try:
                with open(f_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                report_time_str = data.get('report_metadata', {}).get('report_generation_time', '')
                
                # 【關鍵修正】增加對多種日期格式的兼容處理
                report_dt = None
                # 嘗試解析最標準的格式
                try:
                    report_dt = datetime.datetime.strptime(report_time_str, '%Y-%m-%d %H:%M:%S')
                except ValueError:
                    # 如果失敗，嘗試解析 "M/D" 這種簡短格式
                    try:
                        # 假設年份為當前年份
                        report_dt = datetime.datetime.strptime(f"{datetime.date.today().year}/{report_time_str}", '%Y/%m/%d')
                    except ValueError:
                        print(f"    -> 警告: 無法解析報告 '{filename}' 中的日期 '{report_time_str}'。將使用檔案修改時間作為備用。")
                        # 如果所有格式都失敗，使用檔案的最後修改時間作為排序依據
                        report_dt = datetime.datetime.fromtimestamp(os.path.getmtime(f_path))

                # 使用解析出的日期時間來生成顯示名稱和排序鍵
                report_display_name = f"報告 - {report_dt.strftime('%Y年%m月%d日')}"
                
                reports_info.append({
                    "filename": filename,
                    "display_name": report_display_name,
                    "timestamp_sort_key": report_dt.timestamp() # 使用時間戳進行排序
                })

            except (json.JSONDecodeError, KeyError) as e:
                print(f"    -> 警告：處理報告文件 {filename} 時出錯: {e}。已跳過此文件。")
                continue # 跳過這個損壞的檔案
            
        # 按時間戳降序排序，最新的報告在最前面
        if reports_info:
            reports_info.sort(key=lambda x: x["timestamp_sort_key"], reverse=True)
        
        print(f"API Info: 成功處理 {len(reports_info)} 個報告，準備返回。")
        return jsonify(reports_info), 200

    except Exception as e:
        import traceback
        print(f"!!!!!!!!!!!! API 致命錯誤 in /api/student/reports_list !!!!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({'error': '伺服器獲取報告列表時發生內部錯誤。'}), 500

@app.route('/api/student/report', methods=['GET'])
@login_required
def api_get_student_behavior_report():
    if current_user.role != 'student':
        return jsonify({'error': '權限不足'}), 403

    student_id = current_user.username
    requested_report_filename = request.args.get('report_file')

    if not requested_report_filename:
        return jsonify({'error': '未指定要加載的報告文件。'}), 400

    # 安全性檢查：防止路徑遍歷攻擊
    if ".." in requested_report_filename or "/" in requested_report_filename or "\\" in requested_report_filename:
        return jsonify({'error': '無效的報告文件名。'}), 400

    student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student_id)
    report_file_to_load = os.path.join(student_report_folder, requested_report_filename)
    
    print(f"API請求：/api/student/report by User: {student_id}, 請求文件: {requested_report_filename}")

    if not os.path.isfile(report_file_to_load):
        print(f"  錯誤：指定的報告文件不存在: {report_file_to_load}")
        return jsonify({'error': f'指定的報告文件 {requested_report_filename} 未找到。'}), 404

    try:
        with open(report_file_to_load, 'r', encoding='utf-8') as f:
            report_data = json.load(f)
        print(f"  成功讀取並解析JSON文件: {os.path.basename(report_file_to_load)}")
        return jsonify(report_data), 200
    except json.JSONDecodeError:
        return jsonify({'error': f'報告文件 {os.path.basename(report_file_to_load)} 格式錯誤。'}), 500
    except Exception as e:
        print(f"讀取報告文件時發生錯誤: {e}")
        return jsonify({'error': '讀取報告時發生內部錯誤。'}), 500

@app.route('/api/teacher/class_summary', methods=['GET']) # 教師端模擬摘要
@login_required
def api_get_teacher_class_summary():
    if current_user.role != 'teacher':
        return jsonify({'error': '權限不足'}), 403
    mock_class_summary = {
        "class_id": "C101", "report_date": datetime.date.today().strftime("%Y-%m-%d"),
        "behavior_summary": [{"behavior_category": "書寫/做筆記", "percentage": 60.5, "trend": "上升"}],
        "students_needing_attention": [{"student_id": "s1001", "student_name": "王小明", "reason": "專注度低"}]
    }
    return jsonify(mock_class_summary), 200

@app.route('/api/log_click', methods=['POST'])
@login_required
def api_log_click_event():
    data = request.get_json()
    element_clicked = data.get('element')
    if element_clicked:
        # 使用正確的欄位名稱 element_or_page_id
        new_click = ClickLog(user_id=current_user.id, element_or_page_id=element_clicked) 
        db.session.add(new_click)
        db.session.commit()
        return jsonify({'success': True, 'message': '點擊已記錄'}), 200
    return jsonify({'success': False, 'message': '缺少點擊元素信息'}), 400

# --- Helper function to create initial users ---
def create_initial_users():
    with app.app_context():
        db.create_all() # 確保表已創建
        if not User.query.filter_by(username='a123').first():
            student_user = User(username='a123', role='student')
            student_user.set_password('a123')
            db.session.add(student_user)
            print(f"學生用戶 {student_user.username} 已創建。")
        if not User.query.filter_by(username='b123').first():
            teacher_user = User(username='b123', role='teacher')
            teacher_user.set_password('b123')
            db.session.add(teacher_user)
            print(f"教師用戶 {teacher_user.username} 已創建。")
        try:
            db.session.commit()
            print("初始用戶提交完成 (如果之前不存在)。")
        except Exception as e:
            db.session.rollback()
            print(f"提交初始用戶時發生錯誤: {e}")

@app.route('/api/get_sequence_image')
@login_required
def api_get_sequence_image():
    """
    根據報告檔名和圖片檔名，安全地提供圖片檔案。
    這個 API 會從報告 JSON 中讀取元數據，以動態構建圖片的伺服器路徑。
    """
    # === 步驟 1: 獲取並驗證前端傳來的參數 ===
    report_filename = request.args.get('report_file')
    image_filename = request.args.get('image_file')

    # 打印收到的請求，方便除錯
    print(f"\n--- [API /api/get_sequence_image] ---")
    print(f"收到圖片請求: report_file='{report_filename}', image_file='{image_filename}'")

    if not report_filename or not image_filename:
        print("  -> 錯誤: 缺少必要參數。")
        return jsonify({'error': '缺少報告或圖片文件名'}), 400

    # 安全檢查，防止惡意用戶嘗試訪問伺服器上的其他檔案
    if ".." in report_filename or "/" in report_filename or "\\" in report_filename:
        print(f"  -> 安全錯誤: 偵測到無效的報告檔名 '{report_filename}'")
        return jsonify({'error': '無效的報告文件名'}), 400
    if ".." in image_filename or "/" in image_filename or "\\" in image_filename:
        print(f"  -> 安全錯誤: 偵測到無效的圖片檔名 '{image_filename}'")
        return jsonify({'error': '無效的圖片文件名'}), 400

    try:
        # === 步驟 2: 讀取報告 JSON 以獲取元數據 ===
        # 根據報告檔名中的學生姓名來確定資料夾，而不是 current_user.username
        # 這讓教師未來也有可能透過此API查看學生圖片
        match = re.search(r'student_([^_]+)_behavior_report', report_filename)
        if not match:
            print(f"  -> 錯誤: 無法從報告檔名 '{report_filename}' 中解析出學生姓名。")
            return jsonify({'error': '無法解析報告檔名中的學生姓名'}), 400
        
        student_name_from_report = match.group(1)
        
        # 組合報告 JSON 的完整路徑
        report_json_path = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student_name_from_report, report_filename)
        print(f"  正在嘗試讀取報告JSON: {report_json_path}")

        if not os.path.isfile(report_json_path):
            print(f"  -> 錯誤: 報告JSON檔案未找到。")
            return jsonify({'error': '報告JSON文件未找到'}), 404
        
        with open(report_json_path, 'r', encoding='utf-8') as f:
            report_data = json.load(f)
        
        metadata = report_data.get('report_metadata', {})
        student_number = metadata.get('student_number')
        report_time_str = metadata.get('report_generation_time')

        if not student_number or not report_time_str:
            print(f"  -> 錯誤: 報告 '{report_filename}' 中缺少 'student_number' 或 'report_generation_time'。")
            return jsonify({'error': '報告中缺少學生座號或生成時間'}), 404
        
        print(f"  成功讀取元數據: student_number='{student_number}', report_time='{report_time_str}'")

        # === 步驟 3: 根據規則，動態建構圖片的完整路徑 ===
        
        # 1. 處理時間: 將 "6/11" 或 "2024-06-11 10:30:00" 格式化為 "0611"
        report_time_folder = "".join(filter(str.isdigit, report_time_str))
        # 如果是 YYYYMMDD 格式，取中間四位
        if len(report_time_folder) == 8:
             report_time_folder = report_time_folder[4:]
        report_time_folder = report_time_folder.zfill(4)
        
        # 2. 處理座號: 將 "1" 轉換為 "ID_1"
        id_folder = f"ID_{student_number}"
        
        # 3. 使用 os.path.join 安全地組合出最終的圖片路徑
        final_image_path = os.path.join(
            app.config['STUDENT_WEEK_PHOTO_FOLDER'], # 根目錄
            report_time_folder,                     # 日期資料夾，例如 "0611"
            id_folder,                              # 學生ID資料夾，例如 "ID_2"
            "Keyframes",                            # 固定的子資料夾
            image_filename                          # 圖片檔名
        )

        print(f"  -> 準備提供的圖片路徑: {final_image_path}")

        # === 步驟 4: 檢查圖片是否存在並回傳 ===
        if os.path.isfile(final_image_path):
            print(f"  -> 成功找到圖片，正在回傳...")
            return send_file(final_image_path)
        else:
            print(f"  -> 錯誤: 圖片檔案未找到。")
            return jsonify({'error': f'圖片 {image_filename} 未在伺服器上找到'}), 404

    except json.JSONDecodeError:
        print(f"  -> 嚴重錯誤: 報告檔案 {report_filename} 不是有效的JSON。")
        return jsonify({'error': '報告檔案格式錯誤'}), 500
    except Exception as e:
        import traceback
        print(f"  -> 伺服器內部錯誤: 在獲取圖片 {image_filename} 時發生問題: {e}")
        traceback.print_exc() # 打印完整的錯誤堆疊
        return jsonify({'error': '伺服器內部錯誤'}), 500

@app.route('/api/log_page_event', methods=['POST'])
@login_required
def api_log_page_event():
    try:
        data = request.get_json()
        if not data:
            print("API Error: /api/log_page_event - Request body is not valid JSON or is empty.")
            return jsonify({'success': False, 'message': '無效的請求數據'}), 400

        event_type = data.get('event_type')
        element_or_page_id = data.get('element_or_page_id')
        duration_seconds_raw = data.get('duration_seconds') # 先獲取原始值

        print(f"DEBUG: /api/log_page_event - Received data: {data}") # 打印接收到的數據

        if not event_type or not element_or_page_id:
            print("API Error: /api/log_page_event - Missing event_type or element_or_page_id.")
            return jsonify({'success': False, 'message': '缺少事件類型或目標ID'}), 400

        # 處理 duration_seconds
        duration_to_save = None
        if duration_seconds_raw is not None:
            try:
                duration_to_save = int(float(duration_seconds_raw)) # 先轉float再轉int，處理可能的小數
            except (ValueError, TypeError):
                print(f"API Warning: /api/log_page_event - Invalid duration_seconds value: {duration_seconds_raw}. Storing as NULL.")
                # 可以選擇報錯，或者將其存為NULL

        new_log = ClickLog(
            user_id=current_user.id,
            event_type=str(event_type),
            element_or_page_id=str(element_or_page_id),
            duration_seconds=duration_to_save
        )
        db.session.add(new_log)
        db.session.commit()
        print(f"DB Log: Event '{event_type}' for page '{element_or_page_id}' (duration: {duration_to_save}) by user {current_user.id} logged.")
        return jsonify({'success': True, 'message': f'事件 {event_type} 已記錄'}), 200
    
    except Exception as e:
        db.session.rollback()
        # 在伺服器端打印詳細錯誤
        print(f"!!!!!!!!!!!! API ERROR in /api/log_page_event !!!!!!!!!!!!")
        import traceback
        print(traceback.format_exc()) # 打印完整的錯誤追蹤
        print(f"Error details: {str(e)}")
        print(f"Request data that caused error: {request.data}") # 打印原始請求體
        return jsonify({'success': False, 'message': '記錄事件時發生內部錯誤，請查看伺服器日誌。'}), 500

# (可選) 為 navigator.sendBeacon 創建一個單獨的端點
@app.route('/api/log_page_event_beacon', methods=['POST'])
def api_log_page_event_beacon():
    # Beacon 請求通常不帶 cookies，所以 current_user 可能不可用
    # 您需要一種方式從請求體中獲取 user_id，或者先讓前端發送一個包含 user_id 的請求
    # 這裡假設 user_id 被包含在 payload 中 (前端需要添加)
    # 或者，如果 beacon 請求能設法帶上 session cookie (某些情況下可以)，則 current_user 可用
    
    try:
        # Beacon 的 content type 可能是 text/plain
        data_str = request.get_data(as_text=True)
        if not data_str:
            return '', 204 # No content to process

        data = json.loads(data_str) # 假設前端發送的是JSON字符串
        
        user_id_from_payload = data.get('user_id') # 前端JS需要添加這個
        event_type = data.get('event_type')
        element_or_page_id = data.get('element_or_page_id')
        duration_seconds = data.get('duration_seconds')

        if not user_id_from_payload or not event_type or not element_or_page_id:
            print(f"Beacon log 缺少必要數據: {data}")
            return '', 204 # 即使失敗，beacon 通常也不處理響應體

        # 驗證 user_id (可選，但推薦)
        user = User.query.get(int(user_id_from_payload))
        if not user:
            print(f"Beacon log 中的 user_id 無效: {user_id_from_payload}")
            return '', 204

        new_log = ClickLog(
            user_id=user.id,
            event_type=str(event_type),
            element_or_page_id=str(element_or_page_id),
            duration_seconds=int(duration_seconds) if duration_seconds is not None else None
        )
        db.session.add(new_log)
        db.session.commit()
        print(f"Beacon 事件已記錄: {event_type} for user {user.id}")
    except Exception as e:
        print(f"處理 Beacon 日誌錯誤: {e}")
        # Beacon 請求通常不關心響應體，即使出錯也返回成功或無內容
    return '', 204 # No Content, 表示請求已處理


# ****** 修改後的完整 API：教師獲取學生行為摘要 ******
@app.route('/api/teacher/all_students_activity_summary')
@login_required
def get_all_students_activity_summary():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    try:
        # --- 步驟 1: 接收前端傳來的日期參數 ---
        selected_date_str = request.args.get('date')
        if not selected_date_str:
            return jsonify({"error": "必須提供日期參數"}), 400
        
        # 學生查詢
        students = User.query.filter_by(role='student').all()
        summary_data = []

        print(f"\n--- [API /api/teacher/all_students_activity_summary] ---")
        print(f"教師 {current_user.username} 請求摘要。學生總數: {len(students)}。篩選日期: {selected_date_str}")

        # --- 步驟 2: 一次性查詢所有學生的網站活動數據 (性能優化) ---
        all_student_ids = [s.id for s in students]
        
        # 查詢所有相關的點擊日誌
        general_clicks_query = db.session.query(
            ClickLog.user_id,
            db.func.count(ClickLog.id)
        ).filter(
            ClickLog.user_id.in_(all_student_ids),
            ClickLog.event_type == 'click'
        ).group_by(ClickLog.user_id).all()
        
        # 查詢所有相關的標籤頁停留時間
        tab_durations_query = db.session.query(
            ClickLog.user_id,
            ClickLog.element_or_page_id,
            db.func.sum(ClickLog.duration_seconds)
        ).filter(
            ClickLog.user_id.in_(all_student_ids),
            ClickLog.event_type.like('tab_view_end%')
        ).group_by(ClickLog.user_id, ClickLog.element_or_page_id).all()

        # 將查詢結果轉換為字典，方便後續查找
        clicks_by_student = {user_id: count for user_id, count in general_clicks_query}
        time_by_student = {}
        for user_id, page_id, total_seconds in tab_durations_query:
            if user_id not in time_by_student:
                time_by_student[user_id] = {}
            if total_seconds and total_seconds > 0:
                tab_display_name = {
                    'summaryNotesTab': 'AI觀察與建議',
                    'overallStatsTab': '整體行為統計',
                    'timelineTab': '行為趨勢圖',
                    'sequenceDetailsTab': '詳細序列分析'
                }.get(page_id, page_id)
                time_by_student[user_id][tab_display_name] = format_seconds_to_readable(total_seconds)

        # --- 步驟 3: 遍歷學生，處理報告檔案 ---
        for student in students:
            print(f"  正在處理學生: {student.username} (ID: {student.id})")
            
            # 從預先查好的字典中獲取網站互動數據
            total_general_clicks = clicks_by_student.get(student.id, 0)
            time_spent_on_tabs_formatted = time_by_student.get(student.id, {})

            # 初始化報告摘要，確保即使沒有報告檔案，前端也能收到基本結構
            student_report_summary = {
                "latest_report_filename": None,
                "report_date": "無報告",
                "behavior_statistics": [],
                "behavior_to_images_index": {},
                "top_behavior": "N/A",
                "top_behavior_percent": 0,
                "non_task_percent": 0,
            }

            student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student.username)
            
            if os.path.isdir(student_report_folder):
                # 【核心修改】不再使用日期篩選 glob，而是獲取該學生的所有報告進行內部檢查
                all_files = sorted(glob.glob(os.path.join(student_report_folder, f"student_{student.username}_behavior_report_*.json")), reverse=True)
                
                # 【新增邏輯】遍歷所有檔案，找到日期匹配的那一個
                found_report_path = None
                for report_path in all_files:
                    try:
                        # --- START OF MODIFICATION ---
                        report_filename = os.path.basename(report_path)
                        year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                        if not year_match:
                            continue
                        report_year = year_match.group(1)

                        with open(report_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        
                        internal_time_str = data.get('report_metadata', {}).get('report_generation_time')
                        if internal_time_str and isinstance(internal_time_str, str):
                            parts = re.split(r'[/]', internal_time_str)
                            if len(parts) == 2:
                                month, day = parts[0].zfill(2), parts[1].zfill(2)
                                internal_full_date = f"{report_year}-{month}-{day}"
                                
                                if internal_full_date == selected_date_str:
                                    found_report_path = report_path
                                    break
                        # --- END OF MODIFICATION ---
                    except Exception as e:
                        print(f"    警告: 處理學生 {student.username} 的報告 {report_filename} 時出錯: {e}")
                        continue

                if found_report_path:
                    print(f"    找到匹配日期的報告: {os.path.basename(found_report_path)}")
                    
                    try:
                        # 讀取找到的報告檔案內容
                        with open(found_report_path, 'r', encoding='utf-8') as f:
                            report_data = json.load(f)
                        
                        overall_summary = report_data.get("overall_summary", {})
                        
                        # 填充報告摘要資訊
                        student_report_summary["latest_report_filename"] = os.path.basename(found_report_path)
                        student_report_summary["report_date"] = selected_date_str # 直接使用前端傳來的日期作為報告日期

                        behavior_stats = overall_summary.get("behavior_statistics", [])
                        student_report_summary["behavior_statistics"] = behavior_stats

                        # 計算並填充其他摘要欄位
                        if behavior_stats:
                            top_behavior = behavior_stats[0]
                            student_report_summary["top_behavior"] = top_behavior.get("behavior_category", "N/A")
                            student_report_summary["top_behavior_percent"] = top_behavior.get("percentage", 0)
                            
                            non_task_behaviors = {
                                "趴睡",
                                "玩弄手部/文具",
                                "觸摸臉部",
                                "觸摸頭髮",
                                "目視他處",
                                "目視同學"
                            }
                            non_task_total_percent = sum(
                                item.get("percentage", 0) 
                                for item in behavior_stats 
                                if item.get("behavior_category") in non_task_behaviors
                            )
                            student_report_summary["non_task_percent"] = round(non_task_total_percent, 1)

                        student_report_summary["behavior_to_images_index"] = overall_summary.get("behavior_to_images_index", {})

                    except Exception as e:
                        print(f"    錯誤: 讀取或解析學生 {student.username} 的報告 {os.path.basename(found_report_path)} 時出錯: {e}")
                else:
                    print(f"    警告: 學生 {student.username} 在日期 '{selected_date_str}' 沒有找到報告檔案。")
            else:
                print(f"    警告: 未找到學生 {student.username} 的報告資料夾: {student_report_folder}")

            # --- 步驟 5: 組合最終數據 ---
            summary_data.append({
                "student_id": student.id,
                "student_name": student.username,
                "total_general_clicks": total_general_clicks,
                "time_spent_on_tabs_details": time_spent_on_tabs_formatted,
                "report_summary": student_report_summary
            })
        
        print("--- [API /teacher/all_students_activity_summary] 處理完成 ---")
        return jsonify(summary_data)

    except Exception as e:
        import traceback
        print(f"!!!!!!!!!!!! API ERROR in /api/teacher/all_students_activity_summary !!!!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({"error": "伺服器在獲取班級摘要時發生內部錯誤。"}), 500

# 【新增】一個輔助函數來獲取日期，避免重複程式碼
def get_all_available_dates(report_root_folder):
    unique_dates = set()
    if not os.path.isdir(report_root_folder):
        return []

    for student_folder in os.listdir(report_root_folder):
        full_student_path = os.path.join(report_root_folder, student_folder)
        if os.path.isdir(full_student_path):
            file_pattern = os.path.join(full_student_path, "student_*.json")
            for report_path in glob.glob(file_pattern):
                try:
                    filename = os.path.basename(report_path)
                    date_part = filename.split('_')[-2] # student_楊忠潁_behavior_report_20250630_125840.json
                    # 將 YYYYMMDD 格式化為 YYYY-MM-DD
                    if len(date_part) == 8 and date_part.isdigit():
                         report_date = f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:8]}"
                         unique_dates.add(report_date)
                except IndexError:
                    continue # 忽略格式不符的檔名
    
    return sorted(list(unique_dates), reverse=True)

@app.route('/api/teacher/available_report_dates')
@login_required
def get_available_report_dates():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    report_root_folder = app.config['BEHAVIOR_REPORT_FOLDER']
    unique_dates = set()

    if not os.path.isdir(report_root_folder):
        return jsonify([])

    try:
        for student_folder_name in os.listdir(report_root_folder):
            full_student_path = os.path.join(report_root_folder, student_folder_name)
            if os.path.isdir(full_student_path):
                for report_filename in os.listdir(full_student_path):
                    if report_filename.endswith(".json"):
                        report_path = os.path.join(full_student_path, report_filename)
                        try:
                            # 步驟 1: 安全地從檔名獲取年份
                            year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                            if not year_match:
                                print(f"警告：檔案 {report_filename} 名稱格式不符，已跳過。")
                                continue
                            report_year = year_match.group(1)

                            with open(report_path, 'r', encoding='utf-8') as f:
                                data = json.load(f)
                            
                            # 步驟 2: 安全地從 JSON 內部獲取月日
                            metadata = data.get('report_metadata', {})
                            report_time_str = metadata.get('report_generation_time')
                            
                            if not report_time_str or not isinstance(report_time_str, str):
                                print(f"警告：檔案 {report_filename} 內部缺少或格式錯誤的 report_generation_time，已跳過。")
                                continue

                            # 步驟 3: 安全地解析月日並組合
                            parts = re.split(r'[/]', report_time_str)
                            if len(parts) == 2:
                                month = parts[0].zfill(2)
                                day = parts[1].zfill(2)
                                full_date = f"{report_year}-{month}-{day}"
                                unique_dates.add(full_date)
                            else:
                                print(f"警告：檔案 {report_filename} 內部日期格式 '{report_time_str}' 不符，已跳過。")
                                continue

                        # 步驟 4: 捕獲所有其他未預料的錯誤
                        except Exception as e:
                            print(f"警告：處理檔案 {report_filename} 時發生未預期錯誤: {e}")
                            continue
                            
    except Exception as e:
        print(f"錯誤：掃描報告日期時出錯: {e}")
        return jsonify({"error": "掃描報告日期時出錯"}), 500
    
    sorted_dates = sorted(list(unique_dates), reverse=True)
    return jsonify(sorted_dates)


@app.route('/api/teacher/behavior_summary_by_date')
@login_required
def get_behavior_summary_by_date():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    selected_date_str = request.args.get('date')
    if not selected_date_str:
        return jsonify({"error": "必須提供日期參數"}), 400

    report_root_folder = app.config['BEHAVIOR_REPORT_FOLDER']
    aggregated_behaviors = {}

    try:
        for student_folder_name in os.listdir(report_root_folder):
            full_student_path = os.path.join(report_root_folder, student_folder_name)
            if os.path.isdir(full_student_path):
                all_files = glob.glob(os.path.join(full_student_path, f"student_*_behavior_report_*.json"))

                for report_path in all_files:
                    try:
                        # --- START OF MODIFICATION ---
                        report_filename = os.path.basename(report_path)
                        year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                        if not year_match: continue
                        report_year = year_match.group(1)

                        with open(report_path, 'r', encoding='utf-8') as f:
                            report_data = json.load(f)
                        
                        internal_time_str = report_data.get('report_metadata', {}).get('report_generation_time')
                        if internal_time_str and isinstance(internal_time_str, str):
                            parts = re.split(r'[/]', internal_time_str)
                            if len(parts) == 2:
                                month, day = parts[0].zfill(2), parts[1].zfill(2)
                                internal_full_date = f"{report_year}-{month}-{day}"
                                
                                if internal_full_date == selected_date_str:
                                    summary = report_data.get("overall_summary", {})
                                    image_index = summary.get("behavior_to_images_index", {})
                                    for behavior, images in image_index.items():
                                        if behavior not in aggregated_behaviors:
                                            aggregated_behaviors[behavior] = []
                                        for image_file in images:
                                            aggregated_behaviors[behavior].append({
                                                "student_name": student_folder_name,
                                                "report_filename": report_filename,
                                                "image_filename": image_file
                                            })
                        # --- END OF MODIFICATION ---
                    except Exception as e:
                        print(f"警告: 處理報告 {report_filename} 時發生錯誤: {e}")
                        continue
        
        sorted_aggregated_behaviors = dict(sorted(aggregated_behaviors.items()))
        return jsonify(sorted_aggregated_behaviors)

    except Exception as e:
        import traceback
        print(f"!!!!!!!!!!!! API ERROR in /api/teacher/behavior_summary_by_date !!!!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({"error": "伺服器在獲取跨學生行為摘要時發生內部錯誤。"}), 500

@app.route('/api/student/get_workbook_report_for_date', methods=['GET'])
@login_required
def api_get_workbook_report_for_date():
    """
    根據日期獲取對應的、包含練習題的「互動練習冊」報告。
    """
    if current_user.role != 'student':
        return jsonify({"error": "權限不足"}), 403

    report_date_str = request.args.get('date')
    if not report_date_str:
        return jsonify({'error': '未提供日期參數'}), 400

    # 這裡我們假設練習冊報告和筆記報告在同一個資料夾
    # 檔名格式為 interactive_workbook_科目_日期.json
    notes_folder = app.config['NOTES_REPORT_FOLDER']
    if not os.path.isdir(notes_folder):
        return jsonify({'error': f"伺服器錯誤：找不到筆記資料夾"}), 500

    try:
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_suffix_for_filename = date_obj.strftime('%m%d')

        # 尋找練習冊檔案
        file_pattern = os.path.join(notes_folder, f"interactive_workbook_*_{date_suffix_for_filename}.json")
        
        matching_files = glob.glob(file_pattern)

        if not matching_files:
            return jsonify({
                "message": "暫無此日期的練習挑戰可供查看。",
                "workbook_data": None
            }), 200

        latest_workbook_path = matching_files[0]
        
        with open(latest_workbook_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return jsonify(data)

    except Exception as e:
        print(f"為學生 {current_user.username} 獲取日期 {report_date_str} 的練習冊時出錯: {e}")
        return jsonify({"error": "伺服器在獲取練習冊時發生錯誤"}), 500


if __name__ == '__main__':
    # 確保 instance 和 json_behavior 文件夾存在
    instance_path = os.path.join(app.root_path, 'instance')
    json_behavior_path = os.path.join(app.root_path, 'json_behavior')
    if not os.path.exists(instance_path):
        os.makedirs(instance_path)
    if not os.path.exists(json_behavior_path):
        os.makedirs(json_behavior_path)
        print(f"已創建資料夾: {json_behavior_path}")

    with app.app_context(): # 確保在應用上下文中執行 create_all
        create_initial_users()

    app.run(debug=True, host='0.0.0.0', port=8000)