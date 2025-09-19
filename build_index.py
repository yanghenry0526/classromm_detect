# build_index.py (修正版)
import os
import json
import glob
import re
from datetime import datetime

# --- 1. 配置 (與 app.py 保持一致) ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
BEHAVIOR_REPORT_FOLDER = os.path.join(BASE_DIR, 'SynologyDrive', 'json_behavior')
TRAINING_JSON_FOLDER = os.path.join(BASE_DIR, 'training_json')
INDEX_FILENAME = 'report_index.json'

def get_true_report_date(report_path):
    """從報告路徑中，結合檔名和JSON內容，獲取真實的 'YYYY-MM-DD' 日期。"""
    try:
        report_filename = os.path.basename(report_path)
        year_match = re.search(r'_(\d{4})\d{4}_', report_filename)
        if not year_match: return None
        report_year = year_match.group(1)

        with open(report_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        internal_time_str = data.get('report_metadata', {}).get('report_generation_time')
        if internal_time_str and isinstance(internal_time_str, str):
            parts = re.split(r'[/]', internal_time_str)
            if len(parts) == 2:
                month, day = parts[0].zfill(2), parts[1].zfill(2)
                return f"{report_year}-{month}-{day}"
    except Exception:
        return None
    return None

def build_metadata_index():
    """
    掃描所有報告檔案，提取關鍵元數據，並生成一個單一的索引檔。
    """
    print("開始建立元數據索引...")
    
    report_index = {}
    total_files_processed = 0
    error_files_count = 0
    
    if not os.path.isdir(BEHAVIOR_REPORT_FOLDER):
        print(f"錯誤：找不到報告資料夾: {BEHAVIOR_REPORT_FOLDER}")
        return

    student_folders = [d for d in os.listdir(BEHAVIOR_REPORT_FOLDER) if os.path.isdir(os.path.join(BEHAVIOR_REPORT_FOLDER, d))]

    for student_name in student_folders:
        student_path = os.path.join(BEHAVIOR_REPORT_FOLDER, student_name)
        report_files = glob.glob(os.path.join(student_path, "*.json"))

        for report_path in report_files:
            try:
                true_date = get_true_report_date(report_path)
                if not true_date:
                    print(f"  -> 警告: 無法解析日期，跳過檔案: {os.path.basename(report_path)}")
                    continue

                with open(report_path, 'r', encoding='utf-8') as f:
                    report_data = json.load(f)
                
                images_with_confidence = []
                for batch in report_data.get("detailed_sequence_analysis", []):
                    # 【【【 核心修正點：增加安全性檢查 】】】
                    image_filenames = batch.get("image_filenames_in_batch", [])
                    highlights = batch.get("analysis", {}).get("per_image_highlights", [])
                    
                    # 在遍歷之前，先檢查兩個列表的長度是否一致
                    if len(image_filenames) != len(highlights):
                        print(f"  -> 數據不一致警告: 在檔案 {os.path.basename(report_path)} 的批次 {batch.get('batch_index', 'N/A')} 中，圖片數 ({len(image_filenames)}) 與分析數 ({len(highlights)}) 不匹配。將跳過此批次。")
                        continue # 跳過這個數據損壞的 batch

                    # 只有在長度一致時，才進行遍歷
                    for i, image_filename in enumerate(image_filenames):
                        highlight = highlights[i] # 現在這樣存取是安全的
                        
                        behavior_raw = highlight.get("behavior_category", "未知")
                        behavior = behavior_raw[0] if isinstance(behavior_raw, list) else behavior_raw

                        images_with_confidence.append({
                            "image_filename": image_filename,
                            "original_behavior": behavior,
                            "confidence": highlight.get("confidence", 0.0)
                        })

                if not images_with_confidence:
                    print(f"  -> 警告: 檔案 {os.path.basename(report_path)} 未能提取任何有效的圖片數據。")
                    continue
                    
                report_metadata = {
                    "student_name": student_name,
                    "report_filename": os.path.basename(report_path),
                    "images": images_with_confidence
                }

                if true_date not in report_index:
                    report_index[true_date] = []
                report_index[true_date].append(report_metadata)
                
                total_files_processed += 1

            except Exception as e:
                # 捕獲其他所有可能的錯誤
                error_files_count += 1
                print(f"  -> 處理檔案 {os.path.basename(report_path)} 時發生未預期錯誤: {e}")
                continue
    
    # --- 5. 將最終的索引寫入 JSON 檔案 ---
    if not os.path.exists(TRAINING_JSON_FOLDER):
        os.makedirs(TRAINING_JSON_FOLDER)
        
    index_file_path = os.path.join(TRAINING_JSON_FOLDER, INDEX_FILENAME)
    with open(index_file_path, 'w', encoding='utf-8') as f:
        json.dump(report_index, f, ensure_ascii=False) 
    
    print("-" * 30)
    print(f"索引建立完成！")
    print(f"  成功處理: {total_files_processed} 個報告檔案。")
    if error_files_count > 0:
        print(f"  遇到錯誤: {error_files_count} 個檔案。")
    print(f"索引檔案已儲存至: {index_file_path}")

if __name__ == "__main__":
    build_metadata_index()