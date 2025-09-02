# run_all_students.py (v12.0 - 參數傳遞修正版)

import os
import csv
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
from openai import AzureOpenAI, AuthenticationError
from dotenv import load_dotenv

# 從分析模組匯入核心函數
from student_analyzer import analyze_single_student, load_and_preprocess_calibrations

# ==========================================================================
# --- 核心配置區 (所有設定都在此完成) ---
# ==========================================================================
# 1. 報告日期設定
REPORT_DATE_STRING = "08/24"

# 2. 要分析的日期 (對應資料夾名稱)
ANALYSIS_DATE_MMDD = "0824"

# 3. 學生照片起始時間 (HH:MM:SS)
START_TIME_OFFSET_CENTER = "00:13:47"
START_TIME_OFFSET_LEFT   = "00:00:00"
START_TIME_OFFSET_RIGHT  = "00:00:00"

# 4. 要屏蔽的學生ID列表
EXCLUDED_IDS = [1, 2, 6]

# 5. 基礎路徑與檔案設定
MAX_CONCURRENT_STUDENTS = 3
CALIBRATION_DB_PATH = r'C:\Users\User\Desktop\test\training_json\calibration_export.json'
STUDENT_CONFIG_PATH = 'students_config.csv'

# ✅ --- 新增：讀取環境變數和模型部署名稱 ---
load_dotenv()
VISION_DEPLOYMENT_NAME = os.getenv("CHAT_COMPLETION_NAME")
SUMMARY_DEPLOYMENT_NAME = os.getenv("CHAT_COMPLETION_NAME") # 根據您的 .env，它們是相同的

# --- 資料庫根目錄 ---
PHOTO_BASE_FOLDER = r'C:\Users\User\Desktop\test\student_week_photo'

# --- 輔助資料的【完整路徑】---
CLASSROOM_VIEW_FOLDER = rf'C:\Users\User\Desktop\test\student_full_classroom\{ANALYSIS_DATE_MMDD}_english_class'
TEACHER_POS_JSON = rf'C:\Users\User\Desktop\test\teacher_position\{ANALYSIS_DATE_MMDD}_position.json'
CLASSROOM_STATE_JSON = rf'C:\Users\User\Desktop\test\SynologyDrive\image\上課影片\{ANALYSIS_DATE_MMDD}\老師\TXT\{ANALYSIS_DATE_MMDD}.json'

# ==========================================================================
# --- 輔助函數 (無需修改) ---
# ==========================================================================
def generate_task_list(students_config, base_photo_path, date_mmdd, offsets, excluded_ids):
    # ... (此函式內容不變)
    task_list = []
    for student in students_config:
        student_id_num = int(student['id_number'])
        if student_id_num in excluded_ids:
            print(f"🚫 已屏蔽: 學生 {student['name']} (ID: {student_id_num}) 將被跳過。")
            continue
        photo_folder = os.path.join(base_photo_path, date_mmdd, f"ID_{student_id_num}", "Keyframes")
        if not os.path.isdir(photo_folder) or not os.listdir(photo_folder):
            print(f"🟡 警告：學生 {student['name']} (ID: {student_id_num}) 的照片路徑不存在或為空，已跳過。")
            continue
        position = student['position']
        student_offset = "00:00:00"
        if "中間" in position: student_offset = offsets['center']
        elif "左邊" in position: student_offset = offsets['left']
        elif "右邊" in position: student_offset = offsets['right']
        task_list.append({'id': student['name'], 'number': student_id_num, 'folder': photo_folder, 'position': position, 'start_offset': student_offset})
    return task_list

def load_students_config(config_path):
    # ... (此函式內容不變)
    if not os.path.isfile(config_path):
        print(f"❌ 致命錯誤：找不到學生設定檔: {config_path}")
        return None
    try:
        with open(config_path, mode='r', encoding='utf-8-sig') as infile:
            return list(csv.DictReader(infile))
    except Exception as e:
        print(f"❌ 致命錯誤：讀取學生設定檔時發生錯誤: {e}")
        return None
        
# ==========================================================================
# --- 主執行區塊 ---
# ==========================================================================
def main():
    print("--- 智慧學習分析系統 v12.0 - 參數傳遞修正版 ---")
    
    # --- 步驟 1: 整理所有路徑和設定 ---
    final_context_paths = {'classroom_view': CLASSROOM_VIEW_FOLDER, 'teacher_pos': TEACHER_POS_JSON, 'classroom_state': CLASSROOM_STATE_JSON}
    time_offsets = {'center': START_TIME_OFFSET_CENTER, 'left': START_TIME_OFFSET_LEFT, 'right': START_TIME_OFFSET_RIGHT}
    
    # ✅ 新增：將部署名稱打包成字典
    deployment_names = {'vision': VISION_DEPLOYMENT_NAME, 'summary': SUMMARY_DEPLOYMENT_NAME}

    print("\n--- 本次分析設定 ---")
    print(f"報告日期: {REPORT_DATE_STRING}, 分析日期: {ANALYSIS_DATE_MMDD}")
    print(f"屏蔽學生ID: {EXCLUDED_IDS}")
    print(f"視覺模型: {deployment_names['vision']}, 總結模型: {deployment_names['summary']}")
    print("-" * 60)

    # --- 步驟 2: 生成任務清單 ---
    print("正在生成分析任務清單...")
    students_config = load_students_config(STUDENT_CONFIG_PATH)
    if not students_config: return
    all_students_tasks = generate_task_list(students_config, PHOTO_BASE_FOLDER, ANALYSIS_DATE_MMDD, time_offsets, EXCLUDED_IDS)
    if not all_students_tasks:
        print("\n沒有找到任何學生的有效照片資料夾，程式終止。")
        return
    print(f"✅ 成功為 {len(all_students_tasks)} 位學生生成了分析任務。")
    print("-" * 60)

    # --- 步驟 3: 初始化共用物件 ---
    try:
        client = AzureOpenAI(api_key=os.getenv("AZURE_OPENAI_KEY"), azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"), api_version="2024-02-01")
        client.models.list()
        print("✅ Azure OpenAI client 初始化成功。")
    except Exception as e:
        print(f"❌ 致命錯誤：初始化 Azure OpenAI Client 時發生錯誤: {e}")
        return
    
    indexed_calibrations = load_and_preprocess_calibrations(CALIBRATION_DB_PATH)
    print("-" * 60)
    
    # --- 步驟 4: 並行處理所有任務 ---
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_STUDENTS) as executor:
        future_to_student = {
            executor.submit(
                analyze_single_student, 
                student_task, 
                indexed_calibrations, 
                client, 
                final_context_paths,
                REPORT_DATE_STRING,
                deployment_names  # ✅ 新增：傳入部署名稱字典
            ): student_task 
            for student_task in all_students_tasks
        }
        
        for future in tqdm(as_completed(future_to_student), total=len(all_students_tasks), desc="整體分析進度"):
            student_task = future_to_student[future]
            try:
                result_message = future.result()
                print(f"\n✅ 成功: {result_message}")
            except Exception as exc:
                print(f"\n❌ 失敗: 處理學生 {student_task['id']} 時發生嚴重錯誤: {exc}")

    print("\n🎉 --- 所有學生分析完畢 --- 🎉")

if __name__ == "__main__":
    main()