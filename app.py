# app.py (整合版)

import os
import json
import datetime
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import glob

# --- App Configuration ---
app = Flask(__name__, instance_relative_config=True)
app.config['SECRET_KEY'] = os.urandom(24) # 在生產環境中，應使用更安全的固定密鑰管理方式
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///site.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['BEHAVIOR_REPORT_FOLDER'] = os.path.join(app.root_path, 'SynologyDrive\json_behavior')

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

@app.route('/api/student/reports_list', methods=['GET'])
@login_required
def api_get_student_reports_list():
    if current_user.role != 'student':
        return jsonify({'error': '權限不足'}), 403

    student_id = current_user.username
    student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student_id)
    
    if not os.path.isdir(student_report_folder):
        print(f"  警告：未找到學生 {student_id} 的報告文件夾: {student_report_folder}")
        return jsonify([]), 200

    reports_info = []
    # 查找該學生文件夾下所有的JSON報告文件
    file_pattern = os.path.join(student_report_folder, f"student_{student_id}_behavior_report_*.json")
    matching_files = glob.glob(file_pattern)

    for f_path in matching_files:
        filename = os.path.basename(f_path)
        try:
            # 打開 JSON 檔案以讀取內部元數據
            with open(f_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 從 report_metadata 獲取準確的報告生成時間
            report_time_str = data.get('report_metadata', {}).get('report_generation_time', '')
            report_dt = datetime.datetime.strptime(report_time_str, '%Y-%m-%d %H:%M:%S')
            
            report_display_name = f"報告 - {report_dt.strftime('%Y年%m月%d日 %H:%M')}"
            
            reports_info.append({
                "filename": filename,
                "display_name": report_display_name,
                "timestamp_sort_key": report_dt.strftime('%Y%m%d%H%M%S') # 用於排序
            })
        except (json.JSONDecodeError, KeyError, ValueError, FileNotFoundError) as e:
            print(f"    警告：處理報告文件 {filename} 時出錯: {e}。將使用文件名作為備用顯示。")
            reports_info.append({
                "filename": filename,
                "display_name": filename,
                "timestamp_sort_key": "00000000000000" # 確保排序時在最前面或最後面
            })
            
    # 按時間戳降序排序，最新的報告在最前面
    reports_info.sort(key=lambda x: x["timestamp_sort_key"], reverse=True)
    
    return jsonify(reports_info), 200

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

# app.py

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


# ****** 修改API：教師獲取學生行為摘要 ******
@app.route('/api/teacher/all_students_activity_summary')
@login_required
def get_all_students_activity_summary():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    students = User.query.filter_by(role='student').all()
    summary_data = []

    for student in students:
        # --- 1. 計算網頁互動數據 (與您原有的邏輯類似) ---
        total_general_clicks = ClickLog.query.filter(
            ClickLog.user_id == student.id,
            ClickLog.event_type == 'click'
        ).count()
        
        tab_durations_query = db.session.query(
            ClickLog.element_or_page_id,
            db.func.sum(ClickLog.duration_seconds)
        ).filter(
            ClickLog.user_id == student.id,
            ClickLog.event_type.like('tab_view_end%')
        ).group_by(
            ClickLog.element_or_page_id
        ).all()

        time_spent_on_tabs_formatted = {}
        for page_id, total_seconds in tab_durations_query:
            if total_seconds is not None:
                tab_display_name = page_id
                if page_id == 'summaryNotesTab': tab_display_name = 'AI觀察與建議'
                elif page_id == 'overallStatsTab': tab_display_name = '整體行為統計'
                elif page_id == 'timelineTab': tab_display_name = '行為趨勢圖'
                time_spent_on_tabs_formatted[tab_display_name] = format_seconds_to_readable(total_seconds)
        
        # --- 2. 新增：讀取學生最新報告並提取行為摘要 ---
        student_report_summary = {
            "top_behavior": "N/A",
            "top_behavior_percent": 0,
            "non_task_percent": 0,
            "report_date": "無報告"
        }
        
        student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student.username)
        if os.path.isdir(student_report_folder):
            file_pattern = os.path.join(student_report_folder, f"student_{student.username}_behavior_report_*.json")
            matching_files = sorted(glob.glob(file_pattern), reverse=True) # 按檔名排序，最新的在前面
            
            if matching_files:
                latest_report_path = matching_files[0]
                try:
                    with open(latest_report_path, 'r', encoding='utf-8') as f:
                        report_data = json.load(f)
                    
                    # 從報告中提取數據
                    report_date_str = report_data.get("report_metadata", {}).get("report_generation_time", "").split(" ")[0]
                    student_report_summary["report_date"] = report_date_str

                    behavior_stats = report_data.get("overall_summary", {}).get("behavior_statistics", [])
                    if behavior_stats:
                        # 獲取最主要的行為
                        top_behavior = behavior_stats[0]
                        student_report_summary["top_behavior"] = top_behavior.get("behavior_category", "N/A")
                        student_report_summary["top_behavior_percent"] = top_behavior.get("percentage", 0)
                        
                        # 計算非任務相關行為的總百分比
                        non_task_behaviors = {"玩弄物品", "目視同學", "目視他處", "喝水/飲食", "整理個人物品", "趴睡"}
                        non_task_total_percent = sum(
                            item.get("percentage", 0) 
                            for item in behavior_stats 
                            if item.get("behavior_category") in non_task_behaviors
                        )
                        student_report_summary["non_task_percent"] = round(non_task_total_percent, 1)

                except Exception as e:
                    print(f"教師端讀取學生 {student.username} 的報告 {os.path.basename(latest_report_path)} 時出錯: {e}")

        # --- 3. 組合最終數據 ---
        summary_data.append({
            "student_id": student.id,
            "student_name": student.username,
            # 網頁互動數據
            "total_general_clicks": total_general_clicks,
            "time_spent_on_tabs_details": time_spent_on_tabs_formatted,
            # 行為分析報告數據
            "report_summary": student_report_summary
        })
    
    return jsonify(summary_data)

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

    app.run(debug=True)