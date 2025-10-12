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
import datetime
import random

# --- App Configuration ---
app = Flask(__name__, instance_relative_config=True)
app.config['SECRET_KEY'] = os.urandom(24) # 在生產環境中，應使用更安全的固定密鑰管理方式
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///site.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

app.config['REMEMBER_COOKIE_DURATION'] = datetime.timedelta(days=30)

app.config['BEHAVIOR_REPORT_FOLDER'] = os.path.join(app.root_path, 'SynologyDrive\json_behavior')
app.config['STUDENT_WEEK_PHOTO_FOLDER'] = r'C:\Users\User\Desktop\test\student_week_photo'
app.config['NOTES_REPORT_FOLDER'] = r'C:\Users\User\Desktop\test\note_json'
app.config['NOTES_BLACKBOARD_FOLDER'] = r'C:\Users\User\Desktop\test\note_blackboard'
app.config['TRAINING_JSON_FOLDER'] = r'C:\Users\User\Desktop\test\training_json'
app.config['FEW_SHOT_EXAMPLES_FILENAME'] = 'few_shot_examples.json'
app.config['HUMAN_ANNOTATION_FILENAME'] = 'human_annotation_export.json'
app.config['TEACHER_POSITION_FOLDER'] = os.path.join(app.root_path, 'teacher_position')
app.config['CLASS_TIMELINE_FOLDER'] = r'C:\Users\User\Desktop\test\SynologyDrive\image\上課影片'

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'
login_manager.login_message = "請先登入以訪問此頁面。"
login_manager.login_message_category = "info"

@login_manager.unauthorized_handler
def unauthorized():
    # 如果請求是 AJAX/Fetch 請求 (通常會帶有 X-Requested-With header)
    # 或者請求的路徑是 API，則返回 JSON 錯誤
    if request.path.startswith('/api/') or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify(error="使用者未登入或 Session 已過期，請重新登入。"), 401
    
    # 對於一般的頁面瀏覽，則維持原本的重新導向到登入頁
    return redirect(url_for('login_page'))

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

class QuizAttemptLog(db.Model):
    __tablename__ = 'quiz_attempt_log'
    id = db.Column(db.Integer, primary_key=True)
    
    # 【【【 核心修改點 1 】】】
    # 將 user_id 改為 username，並移除外鍵關聯
    username = db.Column(db.String(80), nullable=False) 
    
    # 因為不再有直接的外鍵關聯，所以 user = db.relationship(...) 這一行需要被移除或註解掉
    
    topic_name = db.Column(db.String(200), nullable=False)
    question_text = db.Column(db.Text, nullable=False)
    question_type = db.Column(db.String(50), nullable=False)
    user_answer = db.Column(db.Text, nullable=False)
    correct_answer = db.Column(db.Text, nullable=False)
    is_correct = db.Column(db.Boolean, nullable=False)
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)

    def __repr__(self):
        # 【【【 核心修改點 2 】】】
        # 更新 __repr__ 函數以反映新的欄位名稱
        return f"<QuizAttemptLog User:'{self.username}' Topic:'{self.topic_name}' Correct:'{self.is_correct}'>"
    
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

def enhance_teacher_positions_in_report(report_data):
    """
    【核心輔助函數 v3.0 - 雙向填充最終版】
    對單份學生報告的 detailed_sequence_analysis 進行即時修復，
    實現老師位置的「雙向填充」，確保最大程度的數據覆蓋。
    """
    if not isinstance(report_data, dict):
        return report_data

    detailed_sequence_analysis = report_data.get("detailed_sequence_analysis", [])
    if not detailed_sequence_analysis:
        return report_data

    # 步驟 1: 提取所有批次的原始位置資訊
    positions = []
    for batch in detailed_sequence_analysis:
        if isinstance(batch, dict):
            pos = batch.get("matched_teacher_position_text")
            # 將所有無效值 (包括 "未偵測到", "", None) 都統一處理為 None
            if pos and pos not in ["未偵測到", "未知"]:
                positions.append(pos)
            else:
                positions.append(None)
        else:
            positions.append(None) # 處理 batch 結構不正確的情況

    # 步驟 2: 向前填充 (Forward Fill)
    # 這個迴圈會將所有 None 值替換為其前面最近的一個有效值
    last_valid_position = None
    for i in range(len(positions)):
        if positions[i] is not None:
            last_valid_position = positions[i]
        elif last_valid_position is not None:
            positions[i] = last_valid_position

    # 步驟 3: 向後填充 (Backward Fill)
    # 這個迴圈專門處理開頭連續為 None 的情況
    first_valid_position = None
    for pos in positions:
        if pos is not None:
            first_valid_position = pos
            break
    
    if first_valid_position is not None:
        for i in range(len(positions)):
            if positions[i] is None:
                positions[i] = first_valid_position
            else:
                # 一旦遇到第一個非 None 值，就停止向後填充
                break

    # 步驟 4: 最終備用值處理 (智慧備用版)
    # 如果整份報告都沒有任何有效位置，則嘗試根據學生座位推斷
    initial_fallback_position = "未知"
    metadata = report_data.get("report_metadata", {})
    if metadata:
        # 從報告元數據中獲取學生的座位描述
        student_seat_desc = metadata.get("classroom_context", {}).get("student_position", "")
        # 如果座位描述包含方向性關鍵字，我們就推斷老師在前方
        if any(keyword in student_seat_desc for keyword in ["左邊", "右邊", "中間"]):
            initial_fallback_position = "教室前方"
            
    for i in range(len(positions)):
        if positions[i] is None:
            positions[i] = initial_fallback_position

    # 步驟 5: 將修復好的位置資訊寫回到 report_data 物件中
    for i, batch in enumerate(detailed_sequence_analysis):
        if isinstance(batch, dict) and i < len(positions):
            batch["matched_teacher_position_text"] = positions[i]
            
    return report_data

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
    【v3.0 - 診斷版】
    增加詳細的 print 輸出，用於追蹤檔案搜尋問題。
    """
    # --- 【診斷步驟 1: 確認 API 是否被呼叫以及接收到的日期】 ---
    print("\n" + "="*50)
    print("[API DEBUG] 進入 /api/student/get_note_report_for_date 函數")
    
    if current_user.role != 'student':
        return jsonify({"error": "權限不足"}), 403

    report_date_str = request.args.get('date')
    print(f"[API DEBUG] 收到來自前端的日期參數 (date): '{report_date_str}'")

    if not report_date_str:
        return jsonify({'error': '未提供日期參數'}), 400

    notes_folder = app.config['NOTES_REPORT_FOLDER']
    print(f"[API DEBUG] 系統設定的筆記資料夾路徑 (NOTES_REPORT_FOLDER): '{notes_folder}'")
    
    # --- 【診斷步驟 2: 檢查資料夾是否存在】 ---
    if not os.path.isdir(notes_folder):
        print(f"[API DEBUG] 錯誤：設定的資料夾路徑不存在！")
        return jsonify({'error': f"伺服器錯誤：找不到筆記資料夾"}), 500
    else:
        print(f"[API DEBUG] 成功確認筆記資料夾存在。")


    try:
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_suffix_for_filename = date_obj.strftime('%m%d')
        print(f"[API DEBUG] 解析後的日期後綴 (用於檔名匹配): '{date_suffix_for_filename}'")

        # --- 【診斷步驟 3: 顯示最終的搜尋模式】 ---
        file_pattern = os.path.join(notes_folder, f"knowledge_hub_*_{date_suffix_for_filename}_final.json")
        print(f"[GLOB DEBUG] 準備使用的 glob 搜尋模式: '{file_pattern}'")
        
        matching_files = glob.glob(file_pattern)

        # --- 【診斷步驟 4: 顯示搜尋結果】 ---
        print(f"[GLOB DEBUG] glob 搜尋結果: {matching_files}")
        print("="*50 + "\n")
        
        if not matching_files:
            return jsonify({
                "message": "暫無此日期的課堂筆記可供查看。",
                "knowledge_hub_refined": None
            }), 200

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

def create_initial_users():
    with app.app_context():
        db.create_all() # 確保資料庫和表已創建

        # --- 1. 定義所有需要創建的帳號 ---
        users_to_create = {
            # 學生帳號
            'a123': {'password': 'a123', 'role': 'student'},
            # 原始教師/管理員帳號
            'b123': {'password': 'b123', 'role': 'teacher'},
            # 【【【 三個新的標註員帳號 】】】
            'c123': {'password': 'c123', 'role': 'teacher'},
            'd123': {'password': 'd123', 'role': 'teacher'},
            'e123': {'password': 'e123', 'role': 'teacher'}
        }

        # --- 2. 遍歷並創建帳號 (如果不存在的話) ---
        for username, details in users_to_create.items():
            if not User.query.filter_by(username=username).first():
                new_user = User(username=username, role=details['role'])
                new_user.set_password(details['password'])
                db.session.add(new_user)
                print(f"用戶 {username} (角色: {details['role']}) 已創建。")

        # --- 3. 提交到資料庫 ---
        try:
            db.session.commit()
            print("初始用戶檢查並提交完成。")
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


@app.route('/api/log_quiz_attempt', methods=['POST'])
@login_required
def api_log_quiz_attempt():
    """接收並記錄學生單次提交的所有練習題作答狀況。"""
    
    # 1. 獲取前端發送過來的 JSON 數據
    attempts_data = request.get_json()
    
    # 2. 安全性與格式檢查
    if not attempts_data or not isinstance(attempts_data, list):
        return jsonify({'success': False, 'message': '無效的請求格式，預期應為一個列表。'}), 400

    try:
        # 3. 遍歷列表中的每一筆作答紀錄
        for attempt in attempts_data:
            # 創建一個新的 QuizAttemptLog 物件
            new_log = QuizAttemptLog(
                username=current_user.username,
                topic_name=attempt.get('topic_name'),
                question_text=attempt.get('question_text'),
                question_type=attempt.get('question_type'),
                user_answer=attempt.get('user_answer'),
                correct_answer=attempt.get('correct_answer'),
                is_correct=attempt.get('is_correct'),
                # timestamp 會自動生成
            )
            # 將這個新物件加入到資料庫的 session 中
            db.session.add(new_log)
        
        # 4. 在所有紀錄都處理完畢後，一次性提交到資料庫
        db.session.commit()
        
        print(f"成功為使用者 {current_user.username} 記錄了 {len(attempts_data)} 筆答題紀錄。")
        return jsonify({'success': True, 'message': '答題紀錄已成功儲存。'}), 200

    except Exception as e:
        # 如果過程中發生任何錯誤，則回滾所有操作，避免寫入不完整的資料
        db.session.rollback()
        print(f"!!!!!! 記錄答題時發生嚴重錯誤: {e} !!!!!!")
        return jsonify({'success': False, 'message': '伺服器內部錯誤，無法儲存答題紀錄。'}), 500

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
    """
    【v2.0 - 修正版】
    獲取指定日期的所有學生網站活動摘要和【經過即時修復】的課堂行為報告。
    此版本確保了回傳給前端的報告數據中，老師位置是經過向前填充處理的。
    """
    # --- 步驟 1: 權限檢查與參數獲取 (不變) ---
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    selected_date_str = request.args.get('date')
    if not selected_date_str:
        return jsonify({"error": "必須提供日期參數"}), 400
    
    try:
        # --- 步驟 2: 數據初始化 (不變) ---
        students = User.query.filter_by(role='student').all()
        summary_data = []
        print(f"\n--- [API /api/teacher/all_students_activity_summary] ---")
        print(f"教師 {current_user.username} 請求摘要。學生總數: {len(students)}。篩選日期: {selected_date_str}")

        # --- 步驟 3: (性能優化) 查詢網站活動數據 (不變) ---
        all_student_ids = [s.id for s in students]
        general_clicks_query = db.session.query(
            ClickLog.user_id,
            db.func.count(ClickLog.id)
        ).filter(
            ClickLog.user_id.in_(all_student_ids),
            ClickLog.event_type == 'click'
        ).group_by(ClickLog.user_id).all()
        
        tab_durations_query = db.session.query(
            ClickLog.user_id,
            ClickLog.element_or_page_id,
            db.func.sum(ClickLog.duration_seconds)
        ).filter(
            ClickLog.user_id.in_(all_student_ids),
            ClickLog.event_type.like('tab_view_end%')
        ).group_by(ClickLog.user_id, ClickLog.element_or_page_id).all()

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

        # --- 步驟 4: 遍歷學生，查找、修復並匯總其報告 ---
        for student in students:
            print(f"  正在處理學生: {student.username} (ID: {student.id})")
            
            total_general_clicks = clicks_by_student.get(student.id, 0)
            time_spent_on_tabs_formatted = time_by_student.get(student.id, {})
            
            # 初始化一個空的報告結構作為預設值
            student_report_data = {
                "report_metadata": {"student_id": student.username},
                "overall_summary": {
                    "behavior_statistics": [],
                    "behavior_to_images_index": {}
                },
                "detailed_sequence_analysis": [],
                "error": f"在日期 {selected_date_str} 未找到報告"
            }

            student_report_folder = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student.username)
            
            if os.path.isdir(student_report_folder):
                all_files = sorted(glob.glob(os.path.join(student_report_folder, f"student_{student.username}_behavior_report_*.json")), reverse=True)
                
                found_report_path = None
                for report_path in all_files:
                    try:
                        with open(report_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        
                        internal_time_str = data.get('report_metadata', {}).get('report_generation_time')
                        if not internal_time_str or not isinstance(internal_time_str, str): continue

                        report_filename = os.path.basename(report_path)
                        year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                        if not year_match: continue
                        report_year = year_match.group(1)

                        parts = re.split(r'[/]', internal_time_str)
                        if len(parts) == 2:
                            month, day = parts[0].zfill(2), parts[1].zfill(2)
                            internal_full_date = f"{report_year}-{month}-{day}"
                            if internal_full_date == selected_date_str:
                                found_report_path = report_path
                                break
                    except Exception as e:
                        print(f"    警告: 處理學生 {student.username} 的報告 {os.path.basename(report_path)} 時出錯: {e}")
                        continue
                
                # --- 【【【核心修改邏輯：讀取並即時修復報告】】】 ---
                if found_report_path:
                    print(f"    找到匹配日期的報告: {os.path.basename(found_report_path)}")
                    try:
                        with open(found_report_path, 'r', encoding='utf-8') as f:
                            raw_report_data = json.load(f)
                        
                        # 在這裡呼叫我們的輔助函數來進行即時修復
                        student_report_data = enhance_teacher_positions_in_report(raw_report_data)
                        
                        # 為了前端方便，手動添加一些元數據
                        if "overall_summary" not in student_report_data:
                            student_report_data["overall_summary"] = {}
                        student_report_data["overall_summary"]["latest_report_filename"] = os.path.basename(found_report_path)
                        student_report_data["overall_summary"]["report_date"] = selected_date_str

                    except Exception as e:
                        print(f"    錯誤: 讀取或解析報告 {os.path.basename(found_report_path)} 時出錯: {e}")
                        student_report_data["error"] = "報告檔案解析失敗"
                else:
                    print(f"    警告: 學生 {student.username} 在日期 '{selected_date_str}' 沒有找到報告檔案。")
            else:
                print(f"    警告: 未找到學生 {student.username} 的報告資料夾: {student_report_folder}")

            student_number = student_report_data.get("report_metadata", {}).get("student_number", student.username) 
            # --- 步驟 5: 組合該學生的最終數據 ---
            # 這裡的 "report_summary" 現在包含了完整的、經過修復的報告內容
            summary_data.append({
                "student_id": student.id,
                "student_number": student_number, # 【修改點 2】將 student_name 改為 student_number
                "student_name": student.username, # 【保留】為了向下兼容或未來需要，可以先保留 student_name
                "total_general_clicks": total_general_clicks,
                "time_spent_on_tabs_details": time_spent_on_tabs_formatted,
                "report_summary": student_report_data
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
    """
    獲取所有報告中出現過的、不重複的日期列表。
    此版本嚴格使用 "檔名中的年份" + "JSON內部的月日" 來生成日期，
    這是最權威的日期來源。
    """
    # --- 步驟 1: 權限檢查 ---
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    # --- 步驟 2: 初始化 ---
    report_root_folder = app.config['BEHAVIOR_REPORT_FOLDER']
    unique_dates = set() # 使用集合來自動處理重複日期

    if not os.path.isdir(report_root_folder):
        print(f"警告：報告根目錄未找到: {report_root_folder}")
        return jsonify([])

    try:
        # --- 步驟 3: 遍歷所有學生資料夾和報告檔案 ---
        for student_folder_name in os.listdir(report_root_folder):
            full_student_path = os.path.join(report_root_folder, student_folder_name)
            if os.path.isdir(full_student_path):
                
                for report_filename in os.listdir(full_student_path):
                    # 只處理 JSON 檔案
                    if report_filename.endswith(".json"):
                        report_path = os.path.join(full_student_path, report_filename)
                        
                        try:
                            # 【【【 核心修正邏輯開始 】】】
                            
                            # A. 從檔名安全地獲取年份 (YYYY)
                            year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                            if not year_match:
                                # 如果檔名格式不符，打印警告並跳過此檔案
                                print(f"警告：檔案 {report_filename} 名稱格式不符，無法提取年份，已跳過。")
                                continue
                            report_year = year_match.group(1)

                            # B. 打開檔案，只為了讀取內部的 report_generation_time (MM/DD)
                            with open(report_path, 'r', encoding='utf-8') as f:
                                data = json.load(f)
                            
                            metadata = data.get('report_metadata', {})
                            report_time_str = metadata.get('report_generation_time')
                            
                            if not report_time_str or not isinstance(report_time_str, str):
                                print(f"警告：檔案 {report_filename} 內部缺少或格式錯誤的 report_generation_time，已跳過。")
                                continue

                            # C. 安全地解析月日並與年份組合
                            parts = re.split(r'[/]', report_time_str)
                            if len(parts) == 2:
                                month = parts[0].zfill(2) # 補零，例如 "8" -> "08"
                                day = parts[1].zfill(2)
                                full_date = f"{report_year}-{month}-{day}" # 組合成 "YYYY-MM-DD"
                                unique_dates.add(full_date)
                            else:
                                print(f"警告：檔案 {report_filename} 內部日期格式 '{report_time_str}' 不符合 'MM/DD' 格式，已跳過。")
                                continue

                            # 【【【 核心修正邏輯結束 】】】

                        # 捕獲處理單一檔案時可能發生的所有錯誤，避免中斷整個流程
                        except Exception as e:
                            print(f"警告：處理檔案 {report_filename} 時發生未預期錯誤: {e}")
                            continue
                            
    except Exception as e:
        print(f"錯誤：掃描報告根目錄時發生嚴重錯誤: {e}")
        return jsonify({"error": "掃描報告日期時發生伺服器錯誤"}), 500
    
    # --- 步驟 4: 對結果進行排序並以 JSON 格式返回 ---
    sorted_dates = sorted(list(unique_dates), reverse=True)
    print(f"--- [API /api/teacher/available_report_dates] ---")
    print(f"成功掃描並找到 {len(sorted_dates)} 個不重複的報告日期。")
    return jsonify(sorted_dates)

@app.route('/api/teacher/behavior_summary_by_date')
@login_required
def get_behavior_summary_by_date():
    """
    獲取指定日期的、跨所有學生的行為影像總覽。
    此版本嚴格使用 "檔名中的年份" + "JSON內部的月日" 來篩選符合日期的報告。
    """
    # --- 步驟 1: 權限檢查與參數獲取 ---
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    selected_date_str = request.args.get('date') # e.g., "2025-08-24"
    if not selected_date_str:
        return jsonify({"error": "必須提供日期參數"}), 400

    # --- 步驟 2: 初始化 ---
    report_root_folder = app.config['BEHAVIOR_REPORT_FOLDER']
    aggregated_behaviors = {}
    print(f"\n--- [API /api/teacher/behavior_summary_by_date] ---")
    print(f"請求跨學生行為總覽，篩選日期: {selected_date_str}")


    try:
        # --- 步驟 3: 遍歷所有學生資料夾和報告檔案 ---
        for student_folder_name in os.listdir(report_root_folder):
            full_student_path = os.path.join(report_root_folder, student_folder_name)
            if os.path.isdir(full_student_path):
                
                # 使用 glob 獲取該學生的所有報告檔案
                all_files = glob.glob(os.path.join(full_student_path, f"student_*_behavior_report_*.json"))

                for report_path in all_files:
                    try:
                        # 【【【 核心修正邏輯開始 (與其他 API 的邏輯完全相同) 】】】
                        report_filename = os.path.basename(report_path)
                        
                        # A. 從檔名安全地獲取年份 (YYYY)
                        year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
                        if not year_match: 
                            continue
                        report_year = year_match.group(1)

                        # B. 打開檔案，讀取內部的 report_generation_time (MM/DD)
                        with open(report_path, 'r', encoding='utf-8') as f:
                            report_data = json.load(f)
                        
                        internal_time_str = report_data.get('report_metadata', {}).get('report_generation_time')
                        
                        if internal_time_str and isinstance(internal_time_str, str):
                            # C. 組合出完整的 "YYYY-MM-DD" 日期
                            parts = re.split(r'[/]', internal_time_str)
                            if len(parts) == 2:
                                month, day = parts[0].zfill(2), parts[1].zfill(2)
                                internal_full_date = f"{report_year}-{month}-{day}"
                                
                                # D. 【關鍵】只有當內部日期匹配時，才處理這個檔案
                                if internal_full_date == selected_date_str:
                                    summary = report_data.get("overall_summary", {})
                                    image_index = summary.get("behavior_to_images_index", {})
                                    
                                    # 將圖片資訊聚合到 aggregated_behaviors 中
                                    for behavior, images in image_index.items():
                                        if behavior not in aggregated_behaviors:
                                            aggregated_behaviors[behavior] = []
                                        for image_file in images:
                                            aggregated_behaviors[behavior].append({
                                                "student_name": student_folder_name,
                                                "report_filename": report_filename,
                                                "image_filename": image_file
                                            })
                        # 【【【 核心修正邏輯結束 】】】

                    except Exception as e:
                        print(f"警告: 處理報告 {os.path.basename(report_path)} 時發生錯誤: {e}")
                        continue
        
        # --- 步驟 4: 對結果進行排序並以 JSON 格式返回 ---
        # 按行為類別的名稱排序，讓前端顯示更穩定
        sorted_aggregated_behaviors = dict(sorted(aggregated_behaviors.items()))
        
        print(f"--- [API /api/teacher/behavior_summary_by_date] 處理完成 ---")
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
    【最終版】根據日期獲取對應的「互動練習冊」報告。
    此版本嚴格要求檔名中不包含 "_final.json"。
    """
    if current_user.role != 'student':
        return jsonify({"error": "權限不足"}), 403

    report_date_str = request.args.get('date')
    if not report_date_str:
        return jsonify({'error': '未提供日期參數'}), 400

    notes_folder = app.config['NOTES_REPORT_FOLDER']
    if not os.path.isdir(notes_folder):
        return jsonify({'error': f"伺服器錯誤：找不到筆記資料夾"}), 500

    try:
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_suffix_for_filename = date_obj.strftime('%m%d')

        # --- 【核心修改：恢復為單一、嚴格的搜尋模式】 ---
        # 根據您的檔案命名慣例，練習冊的檔名格式為 "interactive_workbook_..._MMDD.json"
        file_pattern = os.path.join(notes_folder, f"interactive_workbook_*_{date_suffix_for_filename}.json")
        
        matching_files = glob.glob(file_pattern)
            
        # --- 【修改結束】 ---

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

@app.route('/api/teacher/export_calibrations', methods=['POST'])
@login_required
def api_export_calibrations():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    # 獲取本次會話中新增的標註數據
    new_tagged_data = request.get_json()
    if not new_tagged_data or not isinstance(new_tagged_data, list):
        return jsonify({"success": False, "message": "無效的數據格式"}), 400

    try:
        # 定義固定的檔案路徑
        target_folder = app.config['TRAINING_JSON_FOLDER']
        if not os.path.exists(target_folder):
            os.makedirs(target_folder)
        
        file_path = os.path.join(target_folder, 'calibration_export.json')

        # 讀取已有的數據
        existing_data = []
        if os.path.isfile(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                # 處理空檔案的情況
                content = f.read()
                if content:
                    existing_data = json.loads(content)
        
        # 將新數據附加到舊數據後面
        updated_data = existing_data + new_tagged_data
        
        # 【可選但推薦】去重，防止意外的重複數據
        # 我們使用 image_path 作為唯一標識符
        final_data_dict = {item['image_path']: item for item in updated_data}
        final_data_list = list(final_data_dict.values())


        # 將合併並去重後的完整數據寫回同一個檔案
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(final_data_list, f, ensure_ascii=False, indent=4)
        
        print(f"成功更新標註數據: {file_path}")
        return jsonify({
            "success": True, 
            "message": f"成功將 {len(new_tagged_data)} 筆新標註寫入資料庫。",
            "total_records": len(final_data_list)
        }), 200

    except Exception as e:
        print(f"更新標註檔案時發生嚴重錯誤: {e}")
        return jsonify({"success": False, "message": "伺服器內部錯誤"}), 500

# --- 【新增】這個全新的 API，用於在頁面載入時讀取歷史標註 ---
@app.route('/api/teacher/get_calibrations')
@login_required
def api_get_calibrations():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    try:
        file_path = os.path.join(app.config['TRAINING_JSON_FOLDER'], 'calibration_export.json')

        if os.path.isfile(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if content:
                    data = json.loads(content)
                    return jsonify(data)
                else:
                    return jsonify([]) # 如果檔案是空的，返回空列表
        else:
            return jsonify([]) # 如果檔案不存在，返回空列表
            
    except Exception as e:
        print(f"讀取標註檔案時發生錯誤: {e}")
        return jsonify({"error": "讀取標註檔案時出錯"}), 500

def _extract_timestamp_from_filename(filename):
    """從 'HH-MM-SS-ms.jpg' 格式的檔名中提取 'HH:MM:SS' 時間字串"""
    parts = os.path.basename(filename).split('-')
    if len(parts) >= 3:
        return f"{parts[0]}:{parts[1]}:{parts[2]}"
    return None


@app.route('/api/teacher/get_classroom_state')
@login_required
def api_get_classroom_state():
    """
    根據日期和圖片時間戳，從對應的課堂時間軸 JSON 中查找並返回當時的課堂狀態。
    """
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    # 1. 從前端獲取必要參數
    report_date_str = request.args.get('date')    # 'YYYY-MM-DD' 格式
    image_filename = request.args.get('image_file') # 'HH-MM-SS-ms.jpg' 格式

    if not report_date_str or not image_filename:
        return jsonify({"error": "缺少日期或圖片檔名參數"}), 400

    try:
        # 2. 解析參數，準備查找對應的 JSON 檔案
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_folder_name = date_obj.strftime('%m%d') # "2025-09-14" -> "0914"
        
        timeline_filename = f"{date_folder_name}.json"
        timeline_filepath = os.path.join(
            app.config['CLASS_TIMELINE_FOLDER'],
            date_folder_name,
            '老師',
            timeline_filename
        )

        print(f"課堂狀態請求: 日期='{report_date_str}', 查找檔案='{timeline_filepath}'")

        # 3. 讀取並處理時間軸 JSON 檔案
        if not os.path.isfile(timeline_filepath):
            print(f"  -> 警告: 找不到課堂時間軸檔案 {timeline_filepath}")
            return jsonify({
                "classroom_state": "時間軸檔案不存在",
                "state_summary": ""
            })

        with open(timeline_filepath, 'r', encoding='utf-8') as f:
            timeline_data = json.load(f)

        # 4. 執行核心查找邏輯：匹配時間
        image_time_str = _extract_timestamp_from_filename(image_filename) # 'HH:MM:SS'
        if not image_time_str:
            raise ValueError("無法從圖片檔名解析時間")
        
        image_time_obj = datetime.datetime.strptime(image_time_str, '%H:%M:%S').time()

        for interval in timeline_data.get("timeline", []):
            start_time = datetime.datetime.strptime(interval["start_time"], '%H:%M:%S').time()
            end_time = datetime.datetime.strptime(interval["end_time"], '%H:%M:%S').time()

            # 檢查圖片時間是否落在該區間內
            if start_time <= image_time_obj <= end_time:
                print(f"  -> 成功匹配! 時間 '{image_time_str}' 位於區間 '{interval['start_time']}' - '{interval['end_time']}'")
                return jsonify({
                    "classroom_state": interval.get("classroom_state", "未知狀態"),
                    "state_summary": interval.get("state_summary", "")
                })
        
        # 如果迴圈結束都沒找到
        print(f"  -> 警告: 時間 '{image_time_str}' 未能匹配任何課堂活動區間。")
        return jsonify({
            "classroom_state": "無法匹配課堂活動",
            "state_summary": ""
        })

    except Exception as e:
        import traceback
        print(f"!!!!!! API ERROR in /api/teacher/get_classroom_state !!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({"error": f"伺服器內部錯誤: {str(e)}"}), 500

@app.route('/api/teacher/get_dynamic_teacher_position')
@login_required
def api_get_dynamic_teacher_position():
    """
    【全新 API】根據學生圖片的時間戳和日期，動態查找最接近的有效教師位置。
    如果找不到完全匹配的時間，會自動向前查找最近的一個有效紀錄。
    """
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    # 1. 從前端獲取必要參數
    image_filename = request.args.get('image_file')
    # 前端傳來的可能是 'YYYY-MM-DD' 格式
    report_date_str = request.args.get('date') 

    if not image_filename or not report_date_str:
        return jsonify({"error": "缺少圖片檔名或日期參數"}), 400

    try:
        # 2. 解析參數，準備查找
        # 從圖片檔名提取時間戳 (e.g., "01-17-10-250.jpg" -> "01:17:10")
        image_time_str = _extract_timestamp_from_filename(image_filename)
        if not image_time_str:
            return jsonify({"error": "無法從圖片檔名解析時間"}), 400
        
        # 將 'YYYY-MM-DD' 轉換為 'MMDD' 以匹配檔名
        date_obj = datetime.datetime.strptime(report_date_str, '%Y-%m-%d')
        date_prefix = date_obj.strftime('%m%d')
        
        position_filename = f"{date_prefix}_position.json"
        position_filepath = os.path.join(app.config['TEACHER_POSITION_FOLDER'], position_filename)

        print(f"動態位置請求: 圖片時間='{image_time_str}', 查找檔案='{position_filename}'")

        # 3. 讀取並處理老師位置檔案
        if not os.path.isfile(position_filepath):
            print(f"  -> 錯誤: 找不到位置檔案 {position_filepath}")
            return jsonify({"position": "位置檔案不存在"})

        with open(position_filepath, 'r', encoding='utf-8') as f:
            teacher_positions_data = json.load(f)

        # 4. 執行核心查找邏輯：「找不到就往前找」
        
        # 將時間字串轉換為可比較的 timedelta 物件
        target_time = datetime.datetime.strptime(image_time_str, '%H:%M:%S').time()

        best_match_position = "未知" # 預設值
        
        # 為了效率，我們倒序遍歷
        for entry in reversed(teacher_positions_data):
            entry_time_str = entry.get("timestamp")
            entry_position = entry.get("position")

            if not entry_time_str or not entry_position:
                continue

            entry_time = datetime.datetime.strptime(entry_time_str, '%H:%M:%S').time()

            # 如果找到一個時間點 <= 學生圖片的時間點
            if entry_time <= target_time:
                # 並且這個位置是有效的
                if entry_position and entry_position != "未偵測到":
                    best_match_position = entry_position
                    print(f"  -> 找到匹配: 時間'{entry_time_str}' <= '{image_time_str}', 位置='{best_match_position}'")
                    # 因為是倒序找，所以第一個找到的就是最接近的，可以直接跳出
                    break 
        
        # 如果迴圈跑完 best_match_position 仍然是 "未知"，表示圖片時間點之前沒有任何有效紀錄
        if best_match_position == "未知":
             print(f"  -> 警告: 在圖片時間 {image_time_str} 之前未找到任何有效的老師位置紀錄。")

        return jsonify({"position": best_match_position})

    except Exception as e:
        import traceback
        print(f"!!!!!!!!!!!! API ERROR in /api/teacher/get_dynamic_teacher_position !!!!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({"error": f"伺服器內部錯誤: {str(e)}"}), 500

@app.route('/api/teacher/get_image_context')
@login_required
def api_get_image_context():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    report_filename = request.args.get('report_file')
    image_filename = request.args.get('image_file')

    if not report_filename or not image_filename:
        return jsonify({"error": "缺少參數"}), 400
        
    try:
        if ".." in report_filename or "/" in report_filename or "\\" in report_filename:
            return jsonify({'error': '無效的報告檔名'}), 400

        student_name_match = re.search(r'student_([^_]+)_behavior_report', report_filename)
        if not student_name_match:
            return jsonify({"error": "無法從報告檔名中解析學生姓名"}), 400
        student_name = student_name_match.group(1)
        
        report_path = os.path.join(app.config['BEHAVIOR_REPORT_FOLDER'], student_name, report_filename)
        if not os.path.isfile(report_path):
            return jsonify({'error': f'報告檔案 "{report_filename}" 未找到'}), 404

        with open(report_path, 'r', encoding='utf-8') as f:
            report_data = json.load(f)
        
        # --- 【【【核心修改點：在這裡呼叫我們的輔助函數】】】 ---
        report_data = enhance_teacher_positions_in_report(report_data)
        # --- 【【【修改結束】】】 ---

        # 預設上下文結構 (不變)
        context = {
            "teacher_position": "未知", "classroom_subject": "未知", "seating_position": "未知",
            "original_ai_reasoning": "未找到", "original_ai_confidence": 0.0, "batch_context": None,
            "ai_model_version": None, "student_number": "unknown", "report_date_internal": "unknown"
        }

        # 從 metadata 提取基本資訊 (不變)
        metadata = report_data.get("report_metadata", {})
        context["classroom_subject"] = metadata.get("student_image_source_folder", "未知")
        context["seating_position"] = metadata.get("classroom_context", {}).get("student_position", "未知")
        context["student_number"] = metadata.get("student_number", "unknown")
        context["report_date_internal"] = metadata.get("report_generation_time", "unknown")
        context["ai_model_version"] = {
            "vision": metadata.get("analysis_settings", {}).get("vision_model", "未知"),
            "text": metadata.get("analysis_settings", {}).get("text_model", "未知")
        }

        # 從（已經被處理過的）detailed_sequence_analysis 中查找資訊
        for batch in report_data.get("detailed_sequence_analysis", []):
            if image_filename in batch.get("image_filenames_in_batch", []):
                # 現在這裡的 matched_teacher_position_text 已經是填充過的了
                context["teacher_position"] = batch.get("matched_teacher_position_text", "未知")
                
                # 後續的邏輯不變...
                for highlight in batch.get("analysis", {}).get("per_image_highlights", []):
                    try:
                        img_index = highlight.get("image_index_in_sequence")
                        if img_index is not None and 0 <= img_index < len(batch["image_filenames_in_batch"]) and batch["image_filenames_in_batch"][img_index] == image_filename:
                            context["original_ai_reasoning"] = highlight.get("context_description", "未找到")
                            context["original_ai_confidence"] = highlight.get("confidence", 0.0)
                            context["batch_context"] = {"batch_index": batch.get("batch_index", -1), "image_index_in_batch": img_index}
                            return jsonify(context)
                    except (IndexError, TypeError): continue
                
                return jsonify(context)

        return jsonify({'error': f'請求的圖片 "{image_filename}" 未在報告中找到'}), 404

    except Exception as e:
        import traceback
        print(f"伺服器在獲取圖片上下文時發生內部錯誤: {e}")
        traceback.print_exc()
        return jsonify({"error": f"伺服器內部錯誤: {str(e)}"}), 500

@app.route('/api/teacher/get_comprehensive_report_by_date')
@login_required
def api_get_comprehensive_report_by_date():
    """
    根據日期獲取由分析引擎生成的課堂綜合報告。
    """
    # 1. 權限檢查：確保只有老師可以訪問
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    # 2. 獲取前端請求的日期參數
    selected_date_str = request.args.get('date') # 例如，前端會傳來 "2025-09-14"
    if not selected_date_str:
        return jsonify({"error": "必須提供日期參數"}), 400

    try:
        # 3. 根據日期，構建出目標JSON檔案的完整路徑
        # 將 "2025-09-14" 轉換為 "0914" 以匹配檔名
        date_obj = datetime.datetime.strptime(selected_date_str, '%Y-%m-%d')
        date_suffix_for_filename = date_obj.strftime('%m%d')

        # 報告所在的資料夾路徑 (您指定的)
        report_folder = r'C:\Users\User\Desktop\test\classroom_analysis_report'
        
        # 組合出完整的檔案路徑
        report_filename = f"classroom_analysis_report_{date_suffix_for_filename}.json"
        report_filepath = os.path.join(report_folder, report_filename)
        
        print(f"綜合報告請求: 日期='{selected_date_str}', 正在查找檔案='{report_filepath}'")

        # 4. 檢查檔案是否存在，並讀取內容
        if not os.path.isfile(report_filepath):
            print(f"  -> 警告: 找不到綜合分析報告檔案 {report_filepath}")
            # 即使找不到檔案，也正常返回一個空數據的訊息，避免前端報錯
            return jsonify({
                "message": "暫無此日期的課堂綜合洞察報告。",
                "report_data": None
            }), 200

        with open(report_filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 5. 將讀取到的JSON內容作為回應返回給前端
        return jsonify({"report_data": data})

    except Exception as e:
        # 如果過程中發生任何錯誤，捕獲並返回一個服務器錯誤訊息
        print(f"獲取課堂綜合報告時發生錯誤: {e}")
        return jsonify({"error": "伺服器在獲取綜合報告時發生錯誤"}), 500

@app.route('/api/teacher/get_sampled_images_for_annotation')
@login_required
def api_get_sampled_images_for_annotation():
    """
    【v4.0 - 固定序列長度版】
    為校準工作台獲取固定長度為 3 的圖片序列。
    1. 採用分層置信度抽樣找到關鍵幀。
    2. 【核心修改】對每個關鍵幀，獨立生成其前後各一張的序列，不再合併。
    3. 增加序列去重，避免展示完全相同的序列。
    """
    # --- 步驟 0: 權限與參數檢查 ---
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    selected_date_str = request.args.get('date')
    if not selected_date_str:
        return jsonify({"error": "必須提供日期參數"}), 400
        
    # --- 【修改點 1】將 CONTEXT_WINDOW 固定為 1 ---
    TARGET_TOTAL_SAMPLES = 150
    CONTEXT_WINDOW = 1 # 固定上下文為前後各 1 張

    # --- 步驟 1: 讀取歷史標註 (邏輯不變) ---
    historical_annotations = {}
    try:
        annotator_username = current_user.username
        filenames_to_check = [
            f"human_annotation_{annotator_username}.json",
            f"human_annotation_{annotator_username}_v2.json"
        ]
        print(f"\n--- [API /get_sampled_images] 正在為使用者 {annotator_username} 載入歷史標註 ---")
        for filename in filenames_to_check:
            annotation_file_path = os.path.join(app.config['TRAINING_JSON_FOLDER'], filename)
            if os.path.isfile(annotation_file_path):
                print(f"  -> 找到並读取文件: {filename}")
                with open(annotation_file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content:
                        try:
                            data = json.loads(content)
                            for item in data:
                                if isinstance(item, dict) and 'image_path' in item:
                                    historical_annotations[item['image_path']] = item
                        except json.JSONDecodeError:
                            print(f"  -> 警告: 文件 {filename} 不是有效的 JSON，已跳過。")
            else:
                print(f"  -> 未找到文件: {filename} (將跳過)")
        print(f"--- 歷史標註載入完成，共找到 {len(historical_annotations)} 筆不重複的有效記錄 ---")
    except Exception as e:
        print(f"警告：讀取歷史標註文件時發生嚴重錯誤: {e}")
        historical_annotations = {}
    
    # --- 步驟 2: 遍歷學生，進行智慧抽樣並生成固定長度序列 ---
    report_root_folder = app.config['BEHAVIOR_REPORT_FOLDER']
    all_students_sampled_images = {}
    try:
        student_folders = [d for d in os.listdir(report_root_folder) if os.path.isdir(os.path.join(report_root_folder, d))]
        
        for student_name in student_folders:
            # 2a. 尋找符合日期的報告檔案 (邏輯不變)
            student_report_folder = os.path.join(report_root_folder, student_name)
            found_report_path = None
            all_files = sorted(glob.glob(os.path.join(student_report_folder, f"student_{student_name}_behavior_report_*.json")), reverse=True)
            for report_path in all_files:
                try:
                    report_filename_base = os.path.basename(report_path)
                    year_match = re.search(r'_(\d{4})\d{4}_', report_filename_base)
                    if not year_match: continue
                    report_year = year_match.group(1)
                    with open(report_path, 'r', encoding='utf-8') as f: data = json.load(f)
                    internal_time_str = data.get('report_metadata', {}).get('report_generation_time')
                    if internal_time_str and isinstance(internal_time_str, str):
                        parts = re.split(r'[/]', internal_time_str)
                        if len(parts) == 2:
                            month, day = parts[0].zfill(2), parts[1].zfill(2)
                            internal_full_date = f"{report_year}-{month}-{day}"
                            if internal_full_date == selected_date_str:
                                found_report_path = report_path
                                break
                except Exception:
                    continue
            
            if not found_report_path:
                continue

            with open(found_report_path, 'r', encoding='utf-8') as f:
                report_data = json.load(f)
            
            student_number_from_report = report_data.get("report_metadata", {}).get("student_number", student_name)

            # 2b. 建立包含所有图片资讯和索引的完整列表 (邏輯不變)
            all_images_info = []
            current_index = 0
            for batch in report_data.get("detailed_sequence_analysis", []):
                analysis_data = batch.get("analysis", {})
                highlights = analysis_data.get("per_image_highlights", []) if isinstance(analysis_data, dict) else []
                for i, image_filename in enumerate(batch.get("image_filenames_in_batch", [])):
                    try:
                        highlight = highlights[i]
                        confidence = highlight.get("confidence", 0.0)
                        original_behavior_raw = highlight.get("behavior_category", "未知")
                        # 直接傳遞原始數據，無論是列表還是字串
                        original_behavior = original_behavior_raw
                        all_images_info.append({
                            "report_filename": os.path.basename(found_report_path),
                            "image_filename": image_filename,
                            "original_behavior": original_behavior,
                            "student_name": student_name,
                            "student_number": student_number_from_report,
                            "confidence": confidence,
                            "global_index": current_index
                        })
                        current_index += 1
                    except (IndexError, KeyError, TypeError):
                        continue
            
            if not all_images_info:
                continue
            
            # 2c. & 2d. 進行分層置信度抽樣 (邏輯不變)
            num_keyframes_to_sample = round(TARGET_TOTAL_SAMPLES / (1 + 2 * CONTEXT_WINDOW))
            random.seed(f"{selected_date_str}-{student_name}")
            high_confidence_keyframes = [img for img in all_images_info if img['confidence'] >= 0.95]
            low_confidence_keyframes = [img for img in all_images_info if img['confidence'] < 0.95]
            num_high = round(num_keyframes_to_sample * 0.1)
            num_low = num_keyframes_to_sample - num_high
            sampled_high_keys = random.sample(high_confidence_keyframes, k=min(num_high, len(high_confidence_keyframes)))
            sampled_low_keys = random.sample(low_confidence_keyframes, k=min(num_low, len(low_confidence_keyframes)))
            final_keyframes = sorted(sampled_high_keys + sampled_low_keys, key=lambda x: x['global_index'])

            # --- 【修改點 2】核心邏輯改變：不再合併，而是生成獨立的序列 ---
            # 【移除】舊的 final_sample_indices = set() 邏輯

            final_sequences = []
            seen_sequences = set() # 用於防止生成完全重複的序列

            for keyframe in final_keyframes:
                start_index = max(0, keyframe['global_index'] - CONTEXT_WINDOW)
                end_index = min(len(all_images_info), keyframe['global_index'] + CONTEXT_WINDOW + 1)
                
                # 提取這個關鍵幀對應的序列
                sequence = [all_images_info[i] for i in range(start_index, end_index)]
                
                # 建立一個唯一的標識符來檢查此序列是否已添加
                sequence_identifier = tuple(img['image_filename'] for img in sequence)

                if sequence and sequence_identifier not in seen_sequences:
                    final_sequences.append(sequence)
                    seen_sequences.add(sequence_identifier)
            
            # 2g. 預計算標註狀態 (邏輯微調，對每個序列中的圖片進行處理)
            metadata = report_data.get('report_metadata', {})
            date_str_internal = metadata.get('report_generation_time')
            student_num = metadata.get('student_number')
            
            processed_sequences = []
            for sequence in final_sequences:
                processed_sequence = []
                for image_data in sequence:
                    image_full_path = None
                    if date_str_internal and student_num and date_str_internal != "unknown" and student_num != "unknown":
                        date_folder = date_str_internal.replace('/', '')
                        student_id_folder = f"ID_{student_num}"
                        base_path = r'C:\Users\User\Desktop\test\student_week_photo'
                        image_full_path = os.path.join(base_path, date_folder, student_id_folder, 'Keyframes', image_data['image_filename']).replace('/', '\\')
                    
                    image_data['is_tagged'] = bool(image_full_path and image_full_path in historical_annotations)
                    processed_sequence.append(image_data)
                processed_sequences.append(processed_sequence)

            if processed_sequences:
                all_students_sampled_images[student_number_from_report] = processed_sequences

    except Exception as e:
        import traceback
        print(f"!!!!!!!!!!!! API ERROR in /api/teacher/get_sampled_images_for_annotation !!!!!!!!!!!!")
        print(traceback.format_exc())
        return jsonify({"error": "伺服器在抽樣图片时发生内部错误。"}), 500

    # --- 【修改點 3】返回的數據結構已改變 ---
    return jsonify({
        # "sampled_images" 的 value 現在是一個 list of lists
        "sampled_images": all_students_sampled_images,
        "historical_annotations": historical_annotations
    })

# 【新增】API：儲存來自校準工作台的人工標註數據
@app.route('/api/teacher/export_human_annotations', methods=['POST'])
@login_required
def api_export_human_annotations():
    if current_user.role != 'teacher':
        return jsonify({"error": "權限不足"}), 403

    new_tagged_data = request.get_json()
    if not new_tagged_data or not isinstance(new_tagged_data, list):
        return jsonify({"success": False, "message": "無效的數據格式"}), 400

    try:
        target_folder = app.config['TRAINING_JSON_FOLDER']
        if not os.path.exists(target_folder):
            os.makedirs(target_folder)
        
        # 【核心修改】根據當前登入的使用者名稱，動態生成檔名
        # 例如，登入者是 c123，檔名就是 human_annotation_c123.json
        annotator_username = current_user.username
        filename = f"human_annotation_{annotator_username}_v2.json"
        file_path = os.path.join(target_folder, filename)

        # 後續的讀取、去重、寫入邏輯完全不變
        existing_data = []
        if os.path.isfile(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if content:
                    existing_data = json.loads(content)
        
        updated_data = existing_data + new_tagged_data
        
        final_data_dict = {item['image_path']: item for item in updated_data}
        final_data_list = list(final_data_dict.values())

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(final_data_list, f, ensure_ascii=False, indent=4)
        
        print(f"使用者 {annotator_username} 成功更新標註數據: {file_path}")
        return jsonify({
            "success": True, 
            "message": f"成功將 {len(new_tagged_data)} 筆您的個人標註寫入資料庫。",
            "total_records": len(final_data_list)
        }), 200

    except Exception as e:
        print(f"更新人工標註檔案時發生嚴重錯誤: {e}")
        return jsonify({"success": False, "message": "伺服器內部錯誤"}), 500


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