# -*- coding: utf-8 -*-
import os
import re
import base64
import json
import datetime
import time
from collections import Counter, defaultdict
from openai import AzureOpenAI, APIError, RateLimitError, AuthenticationError 
from PIL import Image, UnidentifiedImageError
import io
from tqdm import tqdm
import math
from dotenv import load_dotenv 
from concurrent.futures import ThreadPoolExecutor, as_completed
import bisect
import torch
import chromadb


SAMPLING_RATE = 3  
IMAGE_DETAIL_LEVEL = "low" # 圖片解析度 ('low' 或 'high')，low 可大幅降低成本
MAX_TOKENS_VISION_COMPLETION = 2500
MAX_TOKENS_SUMMARY_COMPLETION = 1000 # 個性化總結的 token
BEHAVIOR_CONFIDENCE_THRESHOLD_FILTER = 0.96 # 行為信度過濾閾值 (例如 70%)
IMAGES_PER_API_CALL = 10 # 一次API調用處理的圖片數量
BEHAVIOR_SIMILARITY_CONFIDENCE_THRESHOLD = 0.15 # 過濾相似連續行為的信度差異閾值
API_RETRY_DELAY_SECONDS = 15
# NUM_RAG_EXAMPLES = 3  # <--- 在這裡設定 RAG 檢索的範例數量

# --- ✅ 新增：動態 RAG 決策引擎的閾值設定 ---
# 1. 每次固定從資料庫中檢索的最大範例數量
MAX_RAG_RESULTS_TO_FETCH = 5

# 2. 高信心閾值：如果最佳匹配的距離低於此值，說明找到完美範例，只用 1 個就夠了
HIGH_CONFIDENCE_THRESHOLD = 0.22 # (可調整)

# 3. 中等信心閾值：如果最佳匹配的距離低於此值，說明找到了不錯的參考，用 3 個來學習模式
MEDIUM_CONFIDENCE_THRESHOLD = 0.28 # (可調整)

# 4. 無效匹配閾值：如果最佳匹配的距離高於此值，說明沒找到任何有意義的參考，不用任何範例
NO_MATCH_THRESHOLD = 0.40 # (可調整)

# ==========================================================

# --- 標準行為分類與定義 (核心辭典，來自圖一) ---
STANDARD_BEHAVIOR_CATEGORIES = {
    "視線": [
        {"label": "目視教師", "definition": "學生的頭部與視線明確聚焦於教室【前方】的【老師所在】區域，且其頭部旋轉角度處於一個【合理的朝前弧度】內（通常不超過45度）。**【絕對排除條款】**: 任何導致學生視線與其身體朝向構成【接近90度或更大角度】的頭部大幅度轉動，【絕對不允許】被標註為『目視教師』。這種姿態應被優先考慮為『目視同學』(`V_CLS`)或『目視他處』(`V_ELS`)。"},
        {"label": "目視黑板", "definition": "學生的頭部與視線明確聚焦於教室【前方】的【非老師所在】的黑板或螢幕區域。當老師位置未知，或學生視線明確未朝向老師時，這是面向前方的預設專注行為。"}, 
        {"label": "目視書本/筆記", "definition": "學生的頭部與視線向量【主要朝下】，且頭部的水平旋轉角度【沒有明顯偏離】其身體所朝向的【個人桌面工作區軸線】。此標籤捕捉的是在個人學習材料上的視覺專注狀態。**【嚴格邊界】**: 一旦頭部/視線明確地、持續地轉向側面（例如，足以與鄰座同學進行眼神交流），即使視線仍然略微朝下，也【必須優先考慮】標註為『目視同學』。**【注意】**：如果學生同時在進行『做筆記』，根據『動作優先』原則，你應將『做筆記』作為主要標籤。"},
        {"label": "目視同學", "definition": "學生的【主要身體朝向與視線】明確脫離前方或個人桌面，轉向側面或後方的同學。**【最高優先級的情境標籤】**: 一旦觀察到這種明確的身體轉向，此標籤的優先級就高於大多數獨立的個人動作。它涵蓋了從純粹的視覺交流到【涉及物件的協作行為】（如共同看書、討論問題）。**【核心情境判斷規則】**: 此行為的性質根據【課堂狀態】決定..."},
        {"label": "目視他處", "definition": "【備用排除性標籤】。當你已確認學生的視線【不】符合『目視教師』、『目視黑板』、『目視書本/筆記』或『目視同學』的任何一項明確定義時，才使用此標籤。它捕捉的是失去焦點的狀態，例如：【抬頭看天花板】、【轉頭看沒有同學及老師的地方】。"}     
    ],
    "肢體(手部)": [
        {"label": "做筆記", "definition": "【核心證據：觀察到一個動態的書寫過程】。你必須能明確看到學生手持筆，且筆尖正在紙張上進行【有意義的移動或書寫/繪製動作】。**【最高優先級】**：這是一個高優先級的動作標籤。**【嚴格排除條款】**：以下情況【絕對不允許】標註為『做筆記』：(1) **靜態持筆**：僅僅手持筆，或筆尖靜止停留在紙上，應標註為『目視書本/筆記』 (`V_BOK`)。(2) **動作中斷**：當學生手部的主要動作變為其他行為（如『觸摸頭髮』、『托腮』、『與同學互動』），即使手中仍持有筆，也必須以該【瞬時動作】為主要標籤。"},
        {"label": "翻書", "definition": "學生手部正在主動翻閱、移動書本。"},
        {"label": "觸摸臉部", "definition": "學生【非支撐性地】用手短暫觸碰或摩擦自己的臉部、鼻子、嘴巴或眼睛。此行為區別於『托腮』的持續性支撐動作。"},
        {"label": "觸摸頭髮", "definition": "學生用手觸摸、撥弄或整理自己的頭髮。注意：即使手臂抬得較高，只要手部的主要動作是與頭髮互動，就【必須】使用此標籤，而不是『舉手』類標籤。"}
    ],
    "身體姿態": [
        {"label": "坐姿直立", "definition": "學生上半身軀幹基本垂直於地面，或輕微前傾。"},
        {"label": "身體前傾", "definition": "學生上半身軀幹明顯向前彎曲，靠近桌面。此行為描述的是一種【清醒狀態下】的姿態。如果學生頭部接觸桌面或手臂，應【優先使用】『趴睡』標籤。"},
        {"label": "身體後靠", "definition": "學生背部倚靠在椅背上。"},
        {"label": "低頭(非學習)", "definition": "【極其嚴格的排除性標籤】。僅在你能夠【極度確信地】觀察到以下【全部】條件時才可使用：1. 學生頭部明顯低垂。2. 其視線【明確沒有】朝向任何學習材料（例如，看向地面、自己的懷中或空無一物的桌面）。3. 其手部沒有在進行任何學習相關操作。"},
        {"label": "趴睡", "definition": "學生將頭部【枕於】手臂或桌面上，呈現明確的休息或睡眠狀態。**【最高優先級】**：只要觀察到頭部接觸桌面或手臂的休息姿態，此標籤的優先級【高於】所有其他學習相關標籤（如『做筆記』、『目視書本』）。"},
        {"label": "托腮", "definition": "【核心定義：手部對頭部提供持續性支撐】。學生使用一隻或兩隻手的手掌、拳頭或手臂，支撐其下巴、臉頰或頭部的重量。這是一個純粹的物理姿態描述，不包含任何意圖推斷。"}
    ],
    "互動": [
        {"label": "主動舉手", "definition": "學生舉起一隻手，意圖提問或回答問題。**【三大核心物理證據，必須同時滿足】**：(1) 手臂向上伸展，手部明顯高於肩膀。(2) 手掌形態為張開朝前或中性放鬆，【嚴禁】手指指向特定方向或揮舞。(3) 該動作具有一定的持續性（非瞬間劃過）。**【情境觸發】**：此行為最常發生在【老師單向授課】的狀態下（如『文法/句型講解』、『閱讀/文章分析』），代表學生的自發性提問或補充。**【絕對排除】**：任何手部接觸頭部、與同學互動的手勢、指向性的動作，都【不允許】標記為此行為。"},
        {"label": "被動舉手", "definition": "學生舉手以回應老師的群體性指令（如投票、調查）。**【核心視覺證據】**：通常是多數學生同時舉手，姿態可能較為放鬆，手臂不必完全伸直。**【情境觸發】**：此行為最常發生在【老師與學生互動】的狀態下（如『課堂問答/互動』、『習題/考卷檢討』），代表學生回應老師的指令或提問。**【關鍵區分】**：此標籤的判斷【高度依賴】課堂情境和群體性動作。如果情境不匹配，應避免使用此標籤。"}
    ],
    "其他狀態": [
        {"label": "喝水", "definition": "【核心證據：清晰可見的容器】。只有當你能夠【明確地】看到學生手持水瓶、杯子或其他容器，並將其送至嘴邊時，才可以使用此標籤。**【嚴格排除】**: 任何僅有低頭姿態、手部靠近臉部但【沒有可見容器】的場景，都【嚴禁】標註為此行為。在此情況下，應優先考慮『目視書本/筆記』(`V_BOK`)或『趴睡』(`P_SLP`)。"},
        {"label": "飲食", "definition": "學生正在食用固體食物。"},
        {"label": "玩弄手部／文具", "definition": "學生手部在進行與學習無關的重複性小動作，例如玩手指、轉筆、玩弄橡皮擦等"},
        # {"label": "整理書包", "definition": "學生正在整理書包、桌面文具。"},
        {"label": "被遮擋/無法判斷", "definition": "【最終備用標籤】。因遮擋、模糊或角度問題，無法清晰識別學生的主要行為時，【必須】使用此標籤。"}
    ]
}
# 自動從新結構生成有效的標籤列表
VALID_BEHAVIOR_LABELS = [item['label'] for category in STANDARD_BEHAVIOR_CATEGORIES.values() for item in category]

BEHAVIOR_CODES = {
    # 視線 (不變)
    "V_TCH": "目視教師", "V_BRD": "目視黑板", "V_BOK": "目視書本/筆記",
    "V_CLS": "目視同學", "V_ELS": "目視他處",
    
    # 肢體(手部) (移除 H_FLIP)
    "H_NOT": "做筆記",
    "H_PLAY_HW": "玩弄手部/文具",
    "H_TOUCH_F": "觸摸臉部",
    "H_TOUCH_H": "觸摸頭髮",
    
    # 身體姿態 (新增 P_THK - P for Posture, THK for Thinking)
    "P_STR": "坐姿直立", "P_LEAN": "身體前傾", "P_BACK": "身體後靠",
    "P_DWN": "低頭(非學習)", "P_SLP": "趴睡",
    "P_THK": "托腮", # <--- 新增
    
    # 互動 (將 I_HND 拆分為主動/被動)
    "I_HND_A": "主動舉手", # A for Active
    "I_HND_P": "被動舉手", # P for Passive
    
    # 其他狀態 (不變)
    "O_DRK_W": "喝水",
    "O_EAT_S": "飲食",
    # "O_TDY": "整理個人物品",
    "O_UNK": "被遮擋/無法判斷"
}

# 自動生成反向查找字典，用於本地解碼
CODE_TO_BEHAVIOR = {code: label for code, label in BEHAVIOR_CODES.items()}
BEHAVIOR_TO_CODE = {label: code for code, label in BEHAVIOR_CODES.items()}

# AI返回標籤到標準標籤的映射規則 (與新標籤對齊)
BEHAVIOR_MAPPING_RULES = {
    "目視桌面/教材": "目視書本", "目視桌面": "目視書本", "看書": "目視書本",
    "書寫/做筆記": "筆記", "動手操作-書寫/做筆記": "筆記",
    "視覺專注-閱讀書本/講義": "目視書本",
    "視覺專注-看老師/黑板方向": "目視教師", "目視黑板/老師": "目視教師",
    "看老師": "目視教師", "看黑板": "目視黑板",
    # --- ↓↓↓ 【修改點】更新映射規則以對應新標籤 ↓↓↓ ---
    "玩弄物品": "玩弄手部/文具", # 將模糊的舊標籤對應到最可能的新標籤
    "非任務相關動作-玩弄物品(筆等)": "玩弄手部/文具",
    # 移除了"非任務相關動作-觸摸臉部/頭髮"，鼓勵AI直接使用更精確的新標籤
    # "非任務相關動作-整理物品": "整理個人物品",
    "社交互動-與同學互動": "目視同學",
    "趴睡/休息": "趴睡",
    "低頭/伏案(非睡)": "低頭",
}

BEHAVIOR_VALENCE_MAP = {
    "正向": [
        "做筆記",
        "主動舉手", # <-- 修改
        "目視教師",
        "目視黑板",
        "目視書本/筆記",
    ],
    "負向": [
        "趴睡",
        "玩弄手部/文具",
        "觸摸臉部",
        "觸摸頭髮",
        "目視他處",
        "目視同學"
    ],
    "中性": [
        "身體前傾",
        "坐姿直立",
        "身體後靠",
        "喝水",
        "飲食",       
        "玩弄手部／文具",
        "翻書",
        "低頭(非學習)",
        # "整理個人物品",     
        "被遮擋/無法判斷",
        "托腮", # <-- 新增
        "被動舉手"  # <-- 新增
    ]
}

LABEL_TO_VALENCE = {
    label: valence 
    for valence, labels in BEHAVIOR_VALENCE_MAP.items() 
    for label in labels
}



def load_teacher_positions(json_path, start_time_offset_str=""):
    if not json_path or not os.path.isfile(json_path):
        print(f"提示：未提供或找不到老師位置 JSON 檔案 ({json_path})。將不使用老師位置情境。")
        return []
    start_offset = parse_time_offset(start_time_offset_str)
    print(f"正在讀取老師位置數據: {json_path}...")
    try:
        with open(json_path, 'r', encoding='utf-8') as f: data = json.load(f)
        position_map, original_count = [], len(data)
        for item in data:
            try:
                h, m, s = map(int, item['timestamp'].split(':'))
                td = datetime.timedelta(hours=h, minutes=m, seconds=s)
                if start_offset and td < start_offset: continue
                position_map.append((td, item['position']))
            except (ValueError, KeyError): continue
        position_map.sort(key=lambda x: x[0])
        if start_offset: print(f"成功加載老師位置數據。根據起始時間 '{start_time_offset_str}' 進行過濾，保留 {len(position_map)} 筆 (原 {original_count} 筆)。")
        else: print(f"成功加載並索引了 {len(position_map)} 筆老師位置數據。")
        return position_map
    except Exception as e:
        print(f"錯誤：讀取或解析老師位置 JSON 時發生問題: {e}"); return []

def load_and_sort_photos(folder_path, photo_type_name, start_time_offset_str=""):
    if not folder_path or not os.path.isdir(folder_path):
        print(f"提示：未提供或找不到 {photo_type_name} 照片資料夾 ({folder_path})。"); return []
    start_offset = parse_time_offset(start_time_offset_str)
    print(f"正在掃描 {photo_type_name} 照片資料夾: {folder_path}...")
    photo_list, original_count = [], 0
    for filename in os.listdir(folder_path):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            original_count += 1
            timestamp = get_timestamp_from_filename(filename)
            if timestamp:
                if start_offset and timestamp < start_offset: continue
                photo_list.append((timestamp, os.path.join(folder_path, filename)))
    if photo_list:
        sorted_photos = sorted(photo_list)
        if start_offset: print(f"成功加載 {photo_type_name} 照片。根據起始時間 '{start_time_offset_str}' 進行過濾，保留 {len(sorted_photos)} 張 (原 {original_count} 張有效格式照片)。")
        else: print(f"成功加載並索引了 {len(sorted_photos)} 張 {photo_type_name} 照片。")
        return sorted_photos
    else:
        print(f"警告：在 {photo_type_name} 照片資料夾 '{folder_path}' 中未找到符合條件的圖片。"); return []

def load_and_preprocess_calibrations(json_path):
    if not os.path.isfile(json_path):
        print("提示：未找到校準檔案，將不使用 Few-Shot 修正。")
        return {}
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        indexed_calibrations = defaultdict(list)
        for record in data:
            original_behavior = record.get("original_behavior")
            if original_behavior:
                indexed_calibrations[original_behavior].append(record)
        for behavior in indexed_calibrations:
            # indexed_calibrations[behavior].sort(key=lambda x: x.get('error_rating', 5))
            indexed_calibrations[behavior].sort(key=lambda x: (-x.get('calibration_confidence', 3), x.get('error_rating', 5)))
        print(f"✅ 成功載入並索引 {len(data)} 筆校準紀錄，涵蓋 {len(indexed_calibrations)} 種錯誤類型。")
        return indexed_calibrations
    except Exception as e:
        print(f"❌ 錯誤：處理校準檔案 {json_path} 時失敗: {e}")
        return {}



# ---------------------------
# 輔助函數
# ---------------------------
def analyze_single_student(student_task, client, context_paths, report_date_str,deployment_names,rag_objects):
    """
    對單一學生進行完整的行為分析並儲存報告。

    :param student_task: 包含學生資訊的字典 (id, number, folder, position, start_offset)
    :param client: AzureOpenAI 客戶端實例
    :param context_paths: 包含所有情境資料路徑的字典 (teacher_pos, classroom_view, classroom_state)
    :param report_date_str: 用於報告元數據的日期字串 (例如 "08/24")
    :param deployment_names: 包含 vision 和 summary 模型部署名稱的字典
    :param rag_objects: 包含 RAG 模型、處理器、資料庫集合和設備的字典
    """
    # 步驟 1: 從傳入的參數中獲取所有必需的資訊
    student_id = student_task['id']
    student_number = student_task['number']
    student_images_folder = student_task['folder']
    student_position = student_task['position']
    
    # 每個學生都有自己專屬的圖片時間偏移量
    student_images_start_offset = student_task.get('start_offset', "00:00:00") 

    teacher_position_json_path = context_paths.get('teacher_pos')
    classroom_images_folder_path = context_paths.get('classroom_view')
    classroom_state_json_path = context_paths.get('classroom_state')
    
    # 注意：這些是固定的，或者可以從 run_all_students 傳入
    teacher_json_offset = "00:00:00"
    classroom_view_offset = student_images_start_offset
    
    # 固定的輸出資料夾
    JSON_OUTPUT_FOLDER = "SynologyDrive/json_behavior"
    JSON_FILENAME_TEMPLATE = "student_{student_id}_behavior_report_{timestamp}.json"

    print(f"\n--- 開始分析學生: {student_id} (座號: {student_number}) ---")
    print(f"座位: {student_position}, 影像路徑: {student_images_folder}")
    print("-" * 50)

    # --- 準備輸出資料夾 ---
    safe_student_id_for_folder = re.sub(r'[\\/*?:"<>|]', "", student_id.replace(" ", "_"))
    student_specific_folder_base = os.path.join(JSON_OUTPUT_FOLDER, safe_student_id_for_folder)
    os.makedirs(student_specific_folder_base, exist_ok=True)

    # --- 準備學生照片資料 (加上了時間偏移) ---
    image_files_with_timestamps = []
    valid_extensions = ('.png', '.jpg', '.jpeg', '.webp')
    student_start_offset_td = parse_time_offset(student_images_start_offset)
    
    print(f"正在掃描學生個人照片資料夾: {student_images_folder}...")
    for filename in os.listdir(student_images_folder):
        if filename.lower().endswith(valid_extensions):
            timestamp = get_timestamp_from_filename(filename)
            if timestamp:
                # 應用學生的個人時間偏移
                if student_start_offset_td and timestamp < student_start_offset_td:
                    continue
                image_files_with_timestamps.append({
                    "path": os.path.join(student_images_folder, filename), "filename": filename,
                    "timestamp_obj": timestamp,
                    "timestamp_str": str(timestamp).split('.')[0]
                })
    image_files_with_timestamps.sort(key=lambda x: x["timestamp_obj"])
    
    # --- 執行圖片取樣 ---
    if SAMPLING_RATE > 1:
        original_count = len(image_files_with_timestamps)
        image_files_with_timestamps = image_files_with_timestamps[::SAMPLING_RATE]
        print(f"已執行圖片取樣：從 {original_count} 張照片中，每 {SAMPLING_RATE} 張取 1 張，共 {len(image_files_with_timestamps)} 張將被分析。")
    else:
        print(f"成功找到 {len(image_files_with_timestamps)} 張學生個人照片 (未取樣)。")

    if not image_files_with_timestamps:
        return f"警告：學生 {student_id} 資料夾中未找到有效圖片，或過濾/取樣後為空。已跳過。"

    # --- 載入所有情境資料 ---
    teacher_positions_data = load_teacher_positions(teacher_position_json_path, teacher_json_offset)
    sorted_classroom_photos = load_and_sort_photos(classroom_images_folder_path, "班級整體", classroom_view_offset)
    classroom_states = load_classroom_states(classroom_state_json_path)

    image_batches = [image_files_with_timestamps[i:i + IMAGES_PER_API_CALL] for i in range(0, len(image_files_with_timestamps), IMAGES_PER_API_CALL)]
    print(f"學生圖片將被分為 {len(image_batches)} 個批次進行分析。")

    # --- 序列化處理所有批次 ---
    all_results_from_threads = []
    previous_batch_result = None
    
    for idx, batch_info in enumerate(tqdm(image_batches, desc=f"分析學生 {student_id}")):
        try:
            result = process_single_batch(
                batch_idx=idx, image_batch_info=batch_info,
                teacher_positions_data=teacher_positions_data,
                sorted_classroom_photos=sorted_classroom_photos, classroom_states=classroom_states,
                client=client, student_id=student_id, student_position=student_position,
                # indexed_calibrations=indexed_calibrations, previous_batch_results=previous_batch_result,
                deployment_names=deployment_names,
                rag_objects=rag_objects
            )
            all_results_from_threads.append(result)
            previous_batch_result = result
        except Exception as exc:
            print(f'\n批次 {idx + 1} 執行時產生錯誤: {exc}')
            all_results_from_threads.append({"batch_index": idx, "error": str(exc)})
            previous_batch_result = None

    all_results_from_threads.sort(key=lambda x: x['batch_index'])
    
    # --- 匯總數據並產生報告 (這部分邏輯完全不變，直接複製貼上即可) ---
    # ... (從 "all_sequence_analysis_results = []" 開始，一直到 final_json_output = { ... } 的所有匯總程式碼)
    all_sequence_analysis_results = []
    overall_behavior_summary = { "total_images_processed_in_batches": 0, "behavior_counts": Counter(), "behavior_confidence_sum": defaultdict(float), "non_task_behavior_examples_for_summary": [] }
    for result in all_results_from_threads:
        if "error" in result:
            all_sequence_analysis_results.append({"batch_index": result['batch_index'] + 1, "analysis": default_error_result_structure()})
            continue
        image_batch_info, sequence_analysis_data = result["image_batch_info"], result["analysis"]
        batch_image_filenames = [info["filename"] for info in image_batch_info]
        all_sequence_analysis_results.append({ "batch_index": result['batch_index'] + 1, "image_filenames_in_batch": batch_image_filenames, "matched_teacher_position_text": result.get("matched_teacher_position_text"), "matched_classroom_view_image": result.get("matched_classroom_view_image"), "analysis": sequence_analysis_data })
        if "error" not in sequence_analysis_data:
            overall_behavior_summary["total_images_processed_in_batches"] += len(batch_image_filenames)
            if "per_image_highlights" in sequence_analysis_data:
                for hl_item in sequence_analysis_data.get("per_image_highlights", []):
                    behavior_list_original = hl_item.get("behavior_category")
                    conf = hl_item.get("confidence", 0.0)
                    UNKNOWN_LABEL = "被遮擋/無法判斷"
                    behavior_list_for_stats = behavior_list_original
                    is_low_confidence = conf is not None and conf < BEHAVIOR_CONFIDENCE_THRESHOLD_FILTER
                    is_empty_behavior = not behavior_list_original
                    if is_low_confidence or is_empty_behavior:
                        behavior_list_for_stats = [UNKNOWN_LABEL]
                    if not behavior_list_for_stats: continue
                    if not isinstance(behavior_list_for_stats, list):
                        behavior_list_for_stats = [behavior_list_for_stats]
                    for cat in behavior_list_for_stats:
                        overall_behavior_summary["behavior_counts"][cat] += 1
                        overall_behavior_summary["behavior_confidence_sum"][cat] += float(conf if conf is not None else 0.0)
                    if behavior_list_original and isinstance(behavior_list_original, list):
                        primary_behavior_for_example = behavior_list_original[0]
                        non_task_keywords = ["玩弄手部/文具", "觸摸臉部", "觸摸頭髮", "目視他處", "趴睡", "喝水", "飲食"]
                        if primary_behavior_for_example in non_task_keywords and len(overall_behavior_summary["non_task_behavior_examples_for_summary"]) < 3:
                            try:
                                student_img_idx = hl_item.get("image_index_in_sequence", -1)
                                if 0 <= student_img_idx < len(batch_image_filenames):
                                    hl_filename = batch_image_filenames[student_img_idx]
                                    hl_timestamp = next((info["timestamp_str"] for info in image_batch_info if info["filename"] == hl_filename), "未知時間")
                                    context_desc = hl_item.get("context_description", "")
                                    overall_behavior_summary["non_task_behavior_examples_for_summary"].append( 
                                        (hl_filename, hl_timestamp, ", ".join(behavior_list_original), context_desc) 
                                    )
                            except Exception as e_idx: print(f"提取非任務示例時出錯: {e_idx}")
    
    overall_behavior_stats_list, total_highlight_instances = [], sum(overall_behavior_summary["behavior_counts"].values())
    valence_summary = {"正向": 0, "負向": 0, "中性": 0}
    for behavior, count in overall_behavior_summary["behavior_counts"].items():
        percentage, avg_confidence = (count / total_highlight_instances * 100) if total_highlight_instances > 0 else 0, (overall_behavior_summary["behavior_confidence_sum"][behavior] / count) if count > 0 else 0
        valence = LABEL_TO_VALENCE.get(behavior, "未分類")
        if valence in valence_summary: valence_summary[valence] += count
        overall_behavior_stats_list.append({ "behavior_category": behavior, "valence": valence, "count": count, "percentage": round(percentage, 1), "average_confidence": round(avg_confidence, 2) })
    overall_behavior_stats_list.sort(key=lambda x: x["count"], reverse=True)
    personalized_notes = generate_personalized_summary_notes(student_id, overall_behavior_stats_list, overall_behavior_summary["non_task_behavior_examples_for_summary"], client, deployment_names['summary'])
    behavior_to_images_map = defaultdict(list)
    for result in all_results_from_threads:
        if "error" in result or "analysis" not in result or "error" in result["analysis"]: continue
        sequence_analysis, image_batch_info, filenames_in_batch = result["analysis"], result.get("image_batch_info", []), [info.get("filename") for info in result.get("image_batch_info", [])]
        if "per_image_highlights" in sequence_analysis and isinstance(sequence_analysis["per_image_highlights"], list):
            for highlight in sequence_analysis["per_image_highlights"]:
                behavior_list, image_index = highlight.get("behavior_category"), highlight.get("image_index_in_sequence")
                if not behavior_list or not isinstance(image_index, int) or not (0 <= image_index < len(filenames_in_batch)): continue
                if not isinstance(behavior_list, list): behavior_list = [behavior_list]
                image_filename = filenames_in_batch[image_index]
                if image_filename:
                    for behavior_category in behavior_list:
                        if image_filename not in behavior_to_images_map[behavior_category]:
                            behavior_to_images_map[behavior_category].append(image_filename)
    for behavior in behavior_to_images_map: behavior_to_images_map[behavior].sort()
    
    total_classified_instances = sum(valence_summary.values())
    valence_summary_with_percentage = { valence: { "count": count, "percentage": round((count / total_classified_instances * 100), 1) if total_classified_instances > 0 else 0 } for valence, count in valence_summary.items() }

    final_json_output = {
        "report_metadata": {
            "student_id": student_id, "student_number": student_number, "report_generation_time": report_date_str, 
            "student_image_source_folder": os.path.basename(student_images_folder),
            "teacher_position_source_json": os.path.basename(teacher_position_json_path) if teacher_position_json_path and os.path.isfile(teacher_position_json_path) else "N/A",
            "classroom_view_source_folder": os.path.basename(classroom_images_folder_path) if classroom_images_folder_path and os.path.isdir(classroom_images_folder_path) else "N/A",
            "classroom_context": { "student_position": student_position },
            "analysis_settings": {
                "vision_model": deployment_names['vision'], "text_model":  deployment_names['summary'], "images_per_batch": IMAGES_PER_API_CALL, 
                "confidence_threshold": BEHAVIOR_CONFIDENCE_THRESHOLD_FILTER,
                "cost_optimization": { "sampling_rate": SAMPLING_RATE, "image_detail": IMAGE_DETAIL_LEVEL }
            }
        },
        "overall_summary": {
            "total_images_found": len(os.listdir(student_images_folder)),
            "total_images_analyzed": overall_behavior_summary["total_images_processed_in_batches"],
            "total_batches": len(image_batches), "valence_summary": valence_summary_with_percentage, "behavior_statistics": overall_behavior_stats_list, 
            "behavior_to_images_index": behavior_to_images_map, "ai_summary_notes": personalized_notes
        },
        "detailed_sequence_analysis": all_sequence_analysis_results
    }

    # --- 儲存檔案並回傳結果 ---
    current_timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_student_id_for_filename = re.sub(r'[\\/*?:"<>|]', "", student_id.replace(" ", "_"))
    json_filename = JSON_FILENAME_TEMPLATE.format(student_id=safe_student_id_for_filename, timestamp=current_timestamp_str)
    json_filepath = os.path.join(student_specific_folder_base, json_filename)
    
    try:
        with open(json_filepath, 'w', encoding='utf-8') as f:
            json.dump(final_json_output, f, ensure_ascii=False, indent=4)
        # 返回一個成功的訊息字串
        return f"學生 '{student_id}' 的報告已成功儲存至: {os.path.basename(json_filepath)}"
    except Exception as e:
        # 拋出一個錯誤，讓 run_all_students.py 可以捕捉到
        raise IOError(f"儲存學生 '{student_id}' 的 JSON 檔案時發生問題：{e}")

# def load_and_preprocess_calibrations(json_path):
#     """
#     【全新】讀取、索引並排序 calibration_export.json。
#     這一步是將扁平的數據列表，轉換成一個高效的、以錯誤為索引的知識庫。
#     """
#     if not os.path.isfile(json_path):
#         print("提示：未找到校準檔案 (calibration_export.json)，將不使用 Few-Shot 修正。")
#         return {}

#     try:
#         with open(json_path, 'r', encoding='utf-8') as f:
#             data = json.load(f)
        
#         indexed_calibrations = defaultdict(list)
#         for record in data:
#             original_behavior = record.get("original_behavior")
#             if original_behavior:
#                 indexed_calibrations[original_behavior].append(record)
        
#         for behavior in indexed_calibrations:
#             indexed_calibrations[behavior].sort(key=lambda x: x.get('error_rating', 5))
            
#         print(f"✅ 成功載入並索引 {len(data)} 筆校準紀錄，涵蓋 {len(indexed_calibrations)} 種錯誤類型。")
#         return indexed_calibrations

#     except Exception as e:
#         print(f"❌ 錯誤：處理校準檔案 {json_path} 時失敗: {e}")
#         return {}

# def select_relevant_examples(indexed_calibrations, previous_batch_results=None, num_examples=1):
#     """
#     【全新】從索引好的知識庫中，動態選擇最相關的範例。
#     """
#     if not indexed_calibrations:
#         return []

#     if previous_batch_results and "analysis" in previous_batch_results:
#         highlights = previous_batch_results["analysis"].get("per_image_highlights", [])
#         if highlights:
#             behavior_counts = Counter(
#                 behavior
#                 for hl in highlights
#                 for behavior in hl.get("behavior_category", []) if isinstance(behavior, str) # 確保是字串
#             )
#             if behavior_counts:
#                 most_common_error, _ = behavior_counts.most_common(1)[0]
#                 if most_common_error in indexed_calibrations:
#                     print(f"  [動態Few-Shot]: 偵測到近期潛在錯誤 '{most_common_error}'，選取針對性修正範例。")
#                     return indexed_calibrations[most_common_error][:num_examples]

#     print("  [動態Few-Shot]: 未找到針對性範例，選取全域最嚴重錯誤範例。")
#     all_examples = [ex for sublist in indexed_calibrations.values() for ex in sublist]
#     all_examples.sort(key=lambda x: x.get('error_rating', 5))
#     return all_examples[:num_examples]
def retrieve_visual_examples_mm_rag(image_path, rag_objects):
    """
    【全新：v2.0 動態 RAG 版】
    根據檢索結果的相似度分數，動態決定要提供給 AI 的範例數量。
    """
    # --- 步驟 1: 從傳入的字典中安全地解包出所需物件 ---
    model = rag_objects.get("model")
    processor = rag_objects.get("processor")
    collection = rag_objects.get("collection")
    device = rag_objects.get("device")

    if not all([model, processor, collection, device]):
        print("  [Dynamic RAG]: 模型或資料庫物件不完整，跳過視覺檢索。")
        return []
    if not os.path.isfile(image_path):
        print(f"  [Dynamic RAG]: 輸入的圖片路徑無效 '{image_path}'，無法進行視覺檢索。")
        return []

    try:
        # --- 步驟 2: 將查詢圖片轉換為向量 (Embedding) ---
        query_image = Image.open(image_path).convert("RGB")
        inputs = processor(images=query_image, return_tensors="pt").to(device)
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)
        norm_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
        query_embedding = norm_features.cpu().numpy().tolist()

        # --- 步驟 3: 固定檢索較多數量的範例，並要求返回距離分數 ---
        results = collection.query(
            query_embeddings=query_embedding,
            n_results=MAX_RAG_RESULTS_TO_FETCH, # <-- 使用我們設定的最大值
            include=['metadatas', 'distances']   # <-- **關鍵**：要求返回距離分數
        )

        # --- 步驟 4: 解包檢索結果 ---
        retrieved_metadatas = results.get('metadatas', [[]])[0]
        distances = results.get('distances', [[]])[0]

        if not distances:
            print("  [Dynamic RAG]: 資料庫中未檢索到任何結果。")
            return []

        # --- 步驟 5: 【【【 核心決策引擎 】】】 ---
        best_score = distances[0] # 最佳匹配的分數 (距離最小)
        final_examples_to_use = []

        if best_score > NO_MATCH_THRESHOLD:
            # 情況 D: 最佳匹配的結果都不夠好，放棄使用範例
            print(f"  [Dynamic RAG]: 無有效匹配 (最佳距離 {best_score:.3f})，不使用任何範例。")
            final_examples_to_use = []
        elif best_score <= HIGH_CONFIDENCE_THRESHOLD:
            # 情況 A: 高信心匹配，只用最相關的那 1 個
            print(f"  [Dynamic RAG]: 高信心匹配 (最佳距離 {best_score:.3f})，使用 1 則範例。")
            final_examples_to_use = retrieved_metadatas[:1]
        elif best_score <= MEDIUM_CONFIDENCE_THRESHOLD:
            # 情況 B: 中等信心匹配，用 3 個來學習模式
            print(f"  [Dynamic RAG]: 中等信心匹配 (最佳距離 {best_score:.3f})，使用 3 則範例。")
            final_examples_to_use = retrieved_metadatas[:3]
        else:
            # 情況 C: 低信心/模糊匹配，提供所有檢索到的範例
            print(f"  [Dynamic RAG]: 低信心/模糊匹配 (最佳距離 {best_score:.3f})，使用全部 {len(retrieved_metadatas)} 則範例。")
            final_examples_to_use = retrieved_metadatas

        if not final_examples_to_use:
            return []

        # --- 步驟 6: 從查詢結果中提取並還原元數據 (與舊版相同) ---
        restored_examples = []
        for meta in final_examples_to_use:
            restored_meta = meta.copy()
            for key, value in restored_meta.items():
                if isinstance(value, str) and value.strip().startswith(('{', '[')):
                    try:
                        restored_meta[key] = json.loads(value)
                    except json.JSONDecodeError:
                        pass
            restored_examples.append(restored_meta)

        if restored_examples:
            print(f"  [Dynamic RAG]: 成功檢索並還原 {len(restored_examples)} 筆視覺相似的範例。")

        return restored_examples

    except Exception as e:
        print(f"  [Dynamic RAG]: 視覺檢索過程中發生嚴重錯誤: {e}")
        return []

def format_examples_for_prompt(examples_list):
    """
    【全新 & 強化版】將挑選出的範例物件，格式化為可以注入 Prompt 的文字字串。
    """
    if not examples_list:
        return ""

    prompt_parts = ["\n---", "**【第五部分：錯誤案例學習與校準 (Few-Shot Examples)】**", "你必須從以下真人校準的案例中學習，以修正你的判斷模型。\n"]
    
    for i, ex in enumerate(examples_list, 1):
        context = ex.get("context", {})
        reasoning = context.get("original_ai_reasoning", "無紀錄")
        confidence = context.get("original_ai_confidence", 0.0)
        seating = context.get("seating_position", "未知座位")
        
        example_context_desc = f"當時學生坐在 **{seating}**，AI 在該次分析中對此圖的信心度為 **{confidence:.2f}**。"
        
        part = f"""
**[學習案例 #{i}]**
*   **情境描述**: {example_context_desc}
*   **AI 錯誤推理 (應避免)**: "{reasoning}"
*   **AI 錯誤輸出 (應避免)**: "{ex.get('original_behavior')}"
*   **專家糾正的正確輸出**: "{ex.get('corrected_behavior')}"
"""
        prompt_parts.append(part)
    
    return "\n".join(prompt_parts)

def find_state_for_timestamp(target_timestamp, classroom_states):
    """
    【v4.0 穩定版】根據時間戳，查找對應的課堂狀態標籤。
    使用線性查找以確保最高的準確性和可靠性。
    """
    if not classroom_states:
        return "未知"
    
    # 為了除錯，只打印一次查找的詳細信息
    if not hasattr(find_state_for_timestamp, "has_logged_first_search"):
        print("\n" + "-"*20 + " [除錯日誌 - 首次查找課堂狀態] " + "-"*20)
        print(f"  - 正在用第一張照片的時間戳进行匹配...")
        print(f"  - 目標時間戳 (Target Timestamp): {target_timestamp}")
        if classroom_states:
            first_state = classroom_states[0]
            print(f"  - 正在检查第一個時間區間: 從 {first_state.get('start_time_td')} 到 {first_state.get('end_time_td')}")
        print("-" * 69 + "\n")
        find_state_for_timestamp.has_logged_first_search = True

    # 遍歷每一個課堂狀態的時間區間
    for state in classroom_states:
        start_td = state.get("start_time_td")
        end_td = state.get("end_time_td")
        
        # 確保這個區間的時間數據是有效的
        if start_td and end_td:
            # 檢查目標時間戳是否落在 [開始時間, 結束時間] 這個閉区间内
            if start_td <= target_timestamp <= end_td:
                return state["classroom_state"]
    
    # 如果遍歷完所有區間都沒找到，說明時間戳確實超出了範圍
    return "未知"

def parse_time_offset(time_str):
    """將 "HH:MM:SS" 格式的字串轉換為 timedelta 物件"""
    if not time_str or not isinstance(time_str, str):
        return None
    try:
        h, m, s = map(int, time_str.split(':'))
        return datetime.timedelta(hours=h, minutes=m, seconds=s)
    except (ValueError, TypeError):
        print(f"警告：時間偏移量 '{time_str}' 格式不正確，應為 'HH:MM:SS'。將忽略此設定。")
        return None

def get_valid_input(prompt_message):
    while True:
        user_input = input(prompt_message).strip()
        if user_input: return user_input
        print("錯誤：輸入不能為空，請重新輸入。")

def get_valid_folder_path(prompt_message, is_optional=False): # 新增 is_optional 參數
    while True:
        folder_path = input(prompt_message).strip().strip('"')
        if not folder_path and is_optional:
            return None # 如果是可選的且用戶未輸入，返回 None
        if os.path.isdir(folder_path):
            return folder_path
        print(f"錯誤：路徑 '{folder_path}' 不是一個有效的資料夾，請重新輸入。")

def get_timestamp_from_filename(filename):
    """
    【v3.1 兼容版】从档名解析时间戳。
    能同时处理 "HH-MM-SS-ms.jpg" 和 "snapshot_HH-MM-SS-ms.jpg" 格式。
    """
    # 模式一：最常見的格式，可能包含 snapshot_ 前綴
    match = re.search(r'(\d{2})-(\d{2})-(\d{2})-(\d{3})\.(jpg|jpeg|png|webp)$', filename, re.IGNORECASE)
    if match:
        try:
            h, m, s, ms, _ = match.groups()
            return datetime.timedelta(hours=int(h), minutes=int(m), seconds=int(s), milliseconds=int(ms))
        except (ValueError, IndexError):
            pass

    # 模式二：備用，匹配包含 h, m, s 的格式
    match = re.search(r'(\d+)h(\d{2})m(\d{2})s', filename)
    if match:
        try:
            h, m, s = map(int, match.groups())
            return datetime.timedelta(hours=h, minutes=m, seconds=s)
        except (ValueError, IndexError):
            pass

    return None

def encode_image_to_base64(image_path, max_size_kb=512, target_quality=75):
    try:
        with Image.open(image_path) as img: img.verify()
        with Image.open(image_path) as img:
            if img.mode == 'RGBA' or img.mode == 'P': img = img.convert('RGB')
            current_quality = target_quality
            output_buffer = io.BytesIO()
            temp_img = img.copy()
            temp_img.save(output_buffer, format="JPEG", quality=current_quality)
            current_size_kb = output_buffer.tell() / 1024

            if current_size_kb > max_size_kb:
                scale_factor = math.sqrt(max_size_kb / current_size_kb)
                new_width = int(temp_img.width * scale_factor * 0.9)
                new_height = int(temp_img.height * scale_factor * 0.9)
                if new_width >= 50 and new_height >= 50: # 最小尺寸限制
                    print(f"    圖片 {os.path.basename(image_path)} ({current_size_kb:.1f} KB) 過大，縮放並調整質量...")
                    temp_img = temp_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    output_buffer = io.BytesIO()
                    temp_img.save(output_buffer, format="JPEG", quality=max(current_quality - 15, 40)) # 質量可以降更多
                else:
                    print(f"    警告: 圖片 {os.path.basename(image_path)} 縮放後過小，可能影響質量。使用較低質量。")
                    output_buffer = io.BytesIO()
                    img.save(output_buffer, format="JPEG", quality=max(current_quality // 2, 30) )


            output_buffer.seek(0)
            binary_data = output_buffer.getvalue()
            base64_encoded_data = base64.b64encode(binary_data)
            return f"data:image/jpeg;base64,{base64_encoded_data.decode('utf-8')}"
    except Exception as e: print(f"錯誤：處理圖片 '{image_path}': {e}"); return None

def load_classroom_states(json_path):
    """【全新】讀取預處理好的課堂狀態時間軸 JSON 檔案。"""
    if not json_path or not os.path.isfile(json_path):
        print("提示：未提供或找不到課堂狀態 JSON 檔案。將不使用課堂情境。")
        return None  # 返回 None 以便更明確地判斷失敗
    
    print(f"正在讀取課堂狀態時間軸: {json_path}...")
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f) # <--- 關鍵修正：將 f 作為參數傳入
            
            # 將時間字串預先轉換為 timedelta 物件以便快速比較
            timeline = data.get("timeline", [])
            for state in timeline:
                state["start_time_td"] = parse_time_offset(state["start_time"])
                state["end_time_td"] = parse_time_offset(state["end_time"])
            print(f"成功載入 {len(timeline)} 個課堂狀態階段。")
            return timeline
    except Exception as e:
        print(f"❌ 錯誤：讀取或解析課堂狀態 JSON 時發生問題: {e}")
        return None # 返回 None

def get_behavior_sequence_analysis_system_prompt(student_position, has_teacher_context , few_shot_prompt_str=""):
    """
    【v14.4 - 終極重構版】
    此版本在 v14.3 的基礎上進行了結構性重構，將所有規則模塊化，
    消除了邏輯冗餘，並將決策樹統一整合，達到了最高的清晰度與可維護性。
    """
    # --- 1. 行為編碼表 (靜態模塊) ---
    behavior_table_for_prompt = "\n\n**【學習行為編碼表】**\n你 **必須** 且 **只能** 從以下列表的「編碼 (Code)」中選擇行為進行標註。...\n"
    for code, label in BEHAVIOR_CODES.items():
        definition = ""
        for category in STANDARD_BEHAVIOR_CATEGORIES.values():
            for item in category:
                if item['label'] == label:
                    definition = item['definition']
                    break
            if definition:
                break
        behavior_table_for_prompt += f"*   **`{code}`**: {label} - {definition}\n"
    behavior_table_for_prompt += "\n*如果行為因任何原因無法清晰判斷，請 **必須** 使用 **`O_UNK`** 編碼。*\n"

    # --- 2. 空間與攝影機規則 (動態模塊) ---
    analysis_view_rules = ""
    if "左" in student_position:
        analysis_view_rules = "*   **分析視角**: 拍攝該學生的【學生個人照片序列】來自教室前方的【左側】攝影機。\n*   **視線基準**: 對於這位學生，【正面朝向鏡頭】僅代表他在看教室的【左前方】。為了看向【教室正前方中心】，他的頭部必須輕微地朝向他自己的【右側】轉動。"
    elif "右" in student_position:
        analysis_view_rules = "*   **分析視角**: 拍攝該學生的【學生個人照片序列】來自教室前方的【右側】攝影機。\n*   **視線基準**: 對於這位學生，【正面朝向鏡頭】僅代表他在看教室的【右前方】。為了看向【教室正前方中心】，他的頭部必須輕微地朝向他自己的【左側】轉動。"
    else: # 預設為中間
        analysis_view_rules = "*   **分析視角**: 拍攝該學生的【學生個人照片序列】來自教室前方的【中間】攝影機。\n*   **視線基準**: 對於這位學生，當他臉部【正面朝向鏡頭】時，即代表其視線正朝向教室的【正前方中心】。"

    camera_and_spatial_rules = f"""
---
**【第一部分：多機位系統與空間推理框架 (最高優先級)】**
你的所有空間判斷都必須基於一個【兩步推理】的框架：首先建立宏觀地圖，然後應用微觀視角。

*   **準則 1A: 宏觀情境視角 (固定中央廣角鏡頭)**
    *   **定義**: 用於情境感知的【班級整體照片】**永遠**來自教室前方的**中央廣角鏡頭**。
    *   **任務**: 你必須使用這張照片來建立一個視覺座標系，將教室劃分為**左側、中央、右側**三個區域，並在其中定位目標學生。

*   **準則 1B: 微觀分析視角 (動態學生鏡頭)**
    *   {analysis_view_rules}

*   **通用空間準則**:
    *   **朝前弧度原則**: 對教室前方的專注行為（`V_TCH`, `V_BRD`）必須發生在一個合理的「朝前弧度」內。一個使學生頭部與其肩膀構成【接近90度】的**大幅度轉頭**，是其注意力【脫離前方】的明確證據，你**必須**將其優先判定為 `V_CLS`。
    *   **影像鏡像轉換**: 所有攝影機畫面都是鏡像的：照片中的**左側** => 教室中的**右側**；照片中的**右側** => 教室中的**左側**。

**【核心執行協議】**:
你的視線分析**必須**結合宏觀與微觀資訊。例如：在班級照片中，你確認學生位於**畫面左側區域** (準則 1A)。同時，`student_position` 文字告訴你拍攝他的鏡頭在**左側** (準則 1B)。綜合這兩點，你才能最準確地判斷他為了看向老師而需要轉動的角度。
"""

    # --- 3. 行為決策協議 (動態模塊) ---
    # 將前後排規則與統一決策協議整合成一個大的、連貫的決策流程
    is_front_row = any(keyword in student_position for keyword in ["第一", "第二"])
    is_rear_row = any(keyword in student_position for keyword in ["第三", "第四"])

    # 3.1 定義前後排獨有的規則
    front_row_rules = """
*   **低頭行為的分診決策樹 (軸線檢查版)**:
    1.  **軸線檢查**: 判斷頭部是【正下方】（判定 `V_BOK`）還是【側下方】（判定 `V_CLS`）。
    2.  **手部動作覆寫**: 檢查是否有隱蔽的非學習動作 (`H_PLAY_HW`) 來覆寫視線判斷。
    3.  **最終備用**: 都不是才使用 `P_DWN`。
*   **前方視線的精確匹配**: 嚴格結合【老師位置情境】進行幾何匹配，判定 `V_TCH` 或 `V_BRD`。
"""
    rear_row_rules = """
*   **低可視度下的姿態優先原則**: 當細節無法辨認時，必須忽略猜測，嚴格依賴姿態鐵則。
*   **低頭行為的「絕對學習推定」原則**: 只要頭部低垂，就**必須、無條件地**判定為 `V_BOK`。
*   **前方視線的「教師優先」原則**: 只要視線朝前，就**優先**標註為 `V_TCH`。
"""

    # 3.2 根據學生位置選擇對應規則
    if is_rear_row:
        position_specific_rules = f"""
**【第二部分：後排學生分析協議 (絕對推斷模式)】**
你必須遵循以下不可動搖的推斷鐵則：
{rear_row_rules}
"""
    else: # 預設為前排
        position_specific_rules = f"""
**【第二部分：前排學生分析協議 (高證據模式)】**
你的所有判斷都必須基於【嚴格的視覺證據】：
{front_row_rules}
"""

    # 3.3 定義統一的、後續的行為決策流程
    universal_decision_flow = """
---
**【第三部分：統一行為決策流程 (全體適用)】**
**【核心原則】**: 你的判斷【必須】基於每一張獨立圖片捕捉到的**瞬時物理證據**。在通過【第二部分】獲得初步的視線判斷後，你必須嚴格遵循以下【單一、統一】的分層決策樹來確定最終的主要行為標籤。

*   **第一層：檢查【壓倒性的身體姿態】(最高優先級)**
    *   **情況 A (向前協作姿態):** 身體【向前或向側前方】探出，進入鄰座同學的桌面空間 -> 主要行為判定為 **`V_BOK`**。**決策結束。**
    *   **情況 B (向後/側面社交姿態):** 身體向【側面或後方】旋轉，與同學進行面對面交流 -> 主要行為判定為 **`V_CLS`**。**決策結束。**

*   **第二層：檢查【定義明確的主動動作】(僅在身體朝前時評估)**
    *   是否在進行**動態的書寫 (`H_NOT`)**？ -> 是 -> `H_NOT` 是主要標籤。**決策結束。**
    *   是否在**玩弄手部/文具 (`H_PLAY_HW`)**？ -> 是 -> `H_PLAY_HW` 是主要標籤。**決策結束。**
    *   手臂是否抬起？ -> 是 -> 執行**【舉手行為過濾器】**（排除 `V_CLS`, `H_TOUCH_H/F` 後，判斷 `I_HND_A/P`）。**決策結束。**

*   **第三層：檢查【其他細微姿態與動作】**
    *   學生是否將頭**枕於**手臂或桌面？ -> 是 -> `P_SLP` (趴睡)。**決策結束。**
    *   學生是否在**托腮 (`P_THK`)**？ -> 是 -> `P_THK` 作為主要標籤。
    *   學生是否在進行**其他非任務相關動作**（如觸摸臉部 `H_TOUCH_F`）？ -> 是 -> 標註對應動作。

*   **第四層：標註【靜態視覺行為】(最終備用選項)**
    *   僅在**所有**上述檢查項都不適用的情況下，才使用在【第二部分】中獲得的**初步視線判斷**（如 `V_TCH`, `V_BOK`）作為最終的主要行為標籤。

*   **第五層：疊加【通用輔助姿態】**
    *   在確定了主要行為後，可疊加一個輔助的姿態標籤（如 `P_LEAN`）。
"""

    # --- 4. 生成最終的、完整的 Prompt ---
    teacher_context_header = "5.  **【老師位置文字情境】**: 用於交叉驗證你視線判斷的輔助數據。" if has_teacher_context else ""

    return f"""
「你是一位世界頂尖的教育分析師，精通電腦視覺、空間幾何推理與心理學。你的任務是綜合所有給定的物理與情境資訊，對學生的學習行為進行最精準、最客觀的標註。」

**【你收到的資訊來源】**
1.  **【班級整體照片】**: 你的【空間座標系】基準。
2.  **【學生個人照片序列】**: 你的主要分析對象。
3.  **【課堂狀態】**: 判斷行為動機的核心上下文。
4.  **【學生座位文字描述】**: `{student_position}`，用於輔助定位。
{teacher_context_header}

{camera_and_spatial_rules}

{position_specific_rules}

{universal_decision_flow}

{behavior_table_for_prompt}

{few_shot_prompt_str} 

---
**【第四部分：輸出格式要求 - 嚴謹推理與簡明輸出】**
*   你的回答**必須**是一個結構完整的、單一的 JSON 物件。
*   `behavior_category` 的值**必須**是一個包含 1 到 2 個編碼字串的**陣列 (Array)**。
*   `per_image_highlights` 的每個物件中**必須包含** `image_index_in_sequence`, `context_description`, `behavior_category`, 和 `confidence` 這四個鍵。
*   **【關鍵指令】**: `context_description` 內容**必須極度簡潔**，例如："後排協議 -> 低頭推定" 或 "左側區域規則 -> 視線匹配"。

**【輸出 JSON 格式範例】**
```json
{{
  "sequence_analysis_confidence": 0.97,
  "per_image_highlights": [
    {{
      "image_index_in_sequence": 0,
      "context_description": "後排協議：低頭推定。",
      "behavior_category": ["V_BOK", "P_STR"],
      "confidence": 0.95
    }},
    {{
      "image_index_in_sequence": 1,
      "context_description": "左側區域規則：頭部右轉，匹配老師位置。",
      "behavior_category": ["V_TCH"],
      "confidence": 0.99
    }},
    {{
      "image_index_in_sequence": 2,
      "context_description": "社交優先：向前協作，判定為 V_BOK。",
      "behavior_category": ["V_BOK", "P_LEAN"],
      "confidence": 0.98
    }}
  ]
}}
```"""

def default_error_result_structure():
    return { "error": "分析失敗或無有效數據", "sequence_analysis_confidence": 0.0, "sequence_summary": "未能生成序列總結。", "dominant_sustained_behaviors": [], "significant_behavior_shifts": [], "per_image_highlights": [], "general_sequence_atmosphere_hint": "未知" }

def clean_analysis_json(raw_analysis):
    """
    清理從 API 返回的分析 JSON，只保留我們需要的欄位。
    這是一個防禦性措施，用來處理微調模型的「幻覺」問題。
    """
    if not isinstance(raw_analysis, dict):
        return default_error_result_structure()

    # 定義合法的鍵
    allowed_top_level_keys = {"sequence_analysis_confidence", "per_image_highlights"}
    allowed_highlight_keys = {"image_index_in_sequence", "context_description", "behavior_category", "confidence"}

    cleaned_analysis = {}
    
    # 1. 清理最外層的鍵
    for key, value in raw_analysis.items():
        if key in allowed_top_level_keys:
            cleaned_analysis[key] = value

    # 2. 檢查並清理 per_image_highlights 列表
    if "per_image_highlights" in cleaned_analysis and isinstance(cleaned_analysis["per_image_highlights"], list):
        cleaned_highlights = []
        for raw_highlight in cleaned_analysis["per_image_highlights"]:
            if not isinstance(raw_highlight, dict):
                continue # 如果列表中的元素不是字典，就跳過它
            
            cleaned_highlight = {}
            for key, value in raw_highlight.items():
                if key in allowed_highlight_keys:
                    cleaned_highlight[key] = value
            
            # 確保必要的鍵存在，即使為空
            for required_key in allowed_highlight_keys:
                if required_key not in cleaned_highlight:
                    cleaned_highlight[required_key] = None

            cleaned_highlights.append(cleaned_highlight)
        
        cleaned_analysis["per_image_highlights"] = cleaned_highlights

    # 3. 如果最外層缺少必要的鍵，補上預設值
    if "sequence_analysis_confidence" not in cleaned_analysis:
        cleaned_analysis["sequence_analysis_confidence"] = 0.0
    if "per_image_highlights" not in cleaned_analysis:
        cleaned_analysis["per_image_highlights"] = []

    return cleaned_analysis

def analyze_student_behavior_from_images_sequence(student_image_paths, teacher_position_text, classroom_view_image_path, classroom_state, image_filenames_batch, openai_client, student_id, student_position , few_shot_prompt_str="", deployment_names=None):
    """
    【v8.1 穩定版】分析單一圖片批次，使用預處理好的「課堂狀態」標籤。
    此版本包含了完整的錯誤處理、JSON清理和穩健性增強。
    """
    if not student_image_paths:
        return default_error_result_structure() # 直接返回錯誤結構，而不是字典
    
    user_message_content = []
    
    # 1. 編碼學生個人圖片序列 (使用配置中的解析度)
    encoded_student_images = []
    for img_path in student_image_paths:
        b64_img = encode_image_to_base64(img_path)
        if b64_img:
            encoded_student_images.append({
                "type": "image_url", 
                "image_url": {"url": b64_img, "detail": IMAGE_DETAIL_LEVEL}
            })

    if not encoded_student_images:
        return default_error_result_structure() # 直接返回錯誤結構
        
    # 2. 編碼班級整體照片 (使用配置中的解析度)
    encoded_classroom_view_image = None
    if classroom_view_image_path:
        b64_img = encode_image_to_base64(classroom_view_image_path)
        if b64_img:
            encoded_classroom_view_image = {
                "type": "image_url", 
                "image_url": {"url": b64_img, "detail": IMAGE_DETAIL_LEVEL}
            }

    # 3. 組合完整的請求體，包含所有情境信息
    user_message_content.append({"type": "text", "text": f"請根據系統提示中的偵探任務，分析學生「{student_id}」的行為。學生照片序列的文件名（供您參考）為: {', '.join(image_filenames_batch)}。"})
    
    # 加入課堂狀態標籤
    state_context_prompt = f"【課堂狀態】: {classroom_state}"
    user_message_content.append({"type": "text", "text": state_context_prompt})

    # 加入老師位置情境
    teacher_context_prompt = f"【老師位置情境】根據預先分析，在此時間段，老師的位置在教室前方的「{teacher_position_text}」。請以此作為判斷『目視教師』的核心依據。"
    user_message_content.append({"type": "text", "text": teacher_context_prompt})
    
    # 依序加入班級照片和學生照片
    if encoded_classroom_view_image:
        user_message_content.append({"type": "text", "text": "【班級整體照片】(用於定位學生和觀察整體氛圍)"})
        user_message_content.append(encoded_classroom_view_image)
    user_message_content.append({"type": "text", "text": "【學生個人照片序列】(主要分析對象)"})
    user_message_content.extend(encoded_student_images)

    # 4. 獲取新的、具備情境感知能力的系統提示
    system_prompt_content = get_behavior_sequence_analysis_system_prompt(student_position, bool(teacher_position_text and teacher_position_text != "未知"),few_shot_prompt_str )

    # 5. API 呼叫與錯誤處理
    retry_attempts = 2
    for attempt in range(retry_attempts + 1):
        raw_content = "" # 初始化 raw_content 以免在 except 區塊中引用未定義變數
        try:
            has_teacher_context = bool(teacher_position_text and teacher_position_text != "未知")
            has_classroom_image = bool(encoded_classroom_view_image)
            has_state = classroom_state != "未知"

            vision_deployment_name = deployment_names.get('vision') if deployment_names else None
            if not vision_deployment_name:
                raise ValueError("視覺模型部署名稱 (vision deployment name) 未提供。")
            
            print(f"  正在向 {vision_deployment_name} 發送請求...")

            response = openai_client.chat.completions.create(
                model=vision_deployment_name, 
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt_content},
                    {"role": "user", "content": user_message_content}
                ],
                max_tokens=MAX_TOKENS_VISION_COMPLETION,
                temperature=0.05
            )
            raw_content = response.choices[0].message.content
            
            # --- ✅【核心修正點】---
            # 步驟 1: 解析原始回應
            analysis_result_raw = json.loads(raw_content)
            
            # 步驟 2: 清理可能包含幻覺的 JSON，確保格式正確
            analysis_result = clean_analysis_json(analysis_result_raw)
            # --- ✅【修正結束】---

            # 本地解碼，將行為編碼轉換回中文標籤列表
            if "per_image_highlights" in analysis_result and isinstance(analysis_result["per_image_highlights"], list):
                for hl in analysis_result["per_image_highlights"]:
                    # 增加穩健性檢查，防止因清理後的 None 值導致錯誤
                    if not hl or not isinstance(hl, dict) or "behavior_category" not in hl:
                        continue
                    
                    codes = hl.get("behavior_category")
                    if not codes: # 處理 behavior_category 為 None 的情況
                        continue

                    if not isinstance(codes, list):
                        codes = [codes]
                    
                    # 過濾掉可能是 None 的 code
                    decoded_behaviors = [CODE_TO_BEHAVIOR.get(code, f"未知編碼({code})") for code in codes if code]
                    hl["behavior_category"] = decoded_behaviors
            
            # 補上空的摘要欄位以保持格式統一 (這一步可以保留，也可以移除，因為 clean_analysis_json 會確保結構)
            if "sequence_summary" not in analysis_result:
                analysis_result["sequence_summary"] = "已設定為精簡模式，此欄位由本地生成。"

            return analysis_result

        except json.JSONDecodeError:
            # 這裡的邏輯是正確的：如果 JSON 本身語法錯誤，就記錄並重試
            print(f"    錯誤：無法解析JSON (第 {attempt+1} 次嘗試)。回應: {raw_content[:500]}...");
            time.sleep(5) # 增加短暫延遲
        except RateLimitError:
            print(f"  警告：API速率限制，等待 {API_RETRY_DELAY_SECONDS}s 後重試...");
            time.sleep(API_RETRY_DELAY_SECONDS)
        except APIError as e:
            wait_time = 10 + attempt * 5 
            print(f"  錯誤：API錯誤 (第 {attempt+1} 次嘗試): {e}. 將在 {wait_time} 秒後重試...");
            time.sleep(wait_time)
        except Exception as e:
            # 處理 NameError 和其他所有未知錯誤
            wait_time = 5 + attempt * 5
            print(f"  錯誤：未知錯誤 (第 {attempt+1} 次嘗試): {e}. 將在 {wait_time} 秒後重試...");
            time.sleep(wait_time)
    
    print(f"  錯誤：圖片序列分析在多次重試後失敗。")
    return default_error_result_structure()

def generate_personalized_summary_notes(student_id, overall_stats, non_task_highlights, openai_client, summary_deployment_name):
    if not openai_client: return {"error": "OpenAI client not available"}
    if not summary_deployment_name: return {"error": "總結模型部署名稱未提供。"}

    stats_summary_for_ai = "\n".join([f"- {s['behavior_category']}: {s['percentage']:.1f}% ({s['count']}次)" for s in overall_stats[:7]]) # 確保百分比格式
    non_task_prompt_part = "該生在本堂課中，未觀察到明顯或頻繁的非任務相關行為。"
    if non_task_highlights:
        highlights_str = "\n".join([f"  - 圖 '{img_fn}' (~{ts}): '{beh}' (描述: {desc})" for img_fn, ts, beh, desc in non_task_highlights[:3]])
        if highlights_str: non_task_prompt_part = f"在本堂課中，觀察到一些非任務相關行為，例如：\n{highlights_str}\n這可能影響了學習專注度。"
    prompt_for_summary = f"""
    「你是一位專業且富有同理心的學習行為教練。你的目標不是批評，而是透過客觀數據，引導學生發現自己的學習模式，並提供能立即實踐的策略，以激發他們『自我反思』的動力。」

    **任務：** 為學生「{student_id}」撰寫一份「AI學習夥伴的觀察與建議」。

    **學生的課堂行為數據：**
    *   **主要行為分佈:**
    {stats_summary_for_ai}
    *   **值得注意的行為片段:**
    {non_task_prompt_part}

    **撰寫指引與 JSON 格式要求：**
    請嚴格遵循以下指引，產生一個結構完整的 JSON 物件。

    *   **`greeting` (問候語):**
        *   用親切、個人化的方式稱呼學生，例如：「嗨，{student_id} 同學，一起來看看這次課堂的學習足跡吧！」

    *   **`positive_feedback` (亮點觀察):**
        *   **必須**從數據中找出最值得肯定的行為（例如「目視教師」或「筆記」佔比最高），並給予具體、真誠的讚美。
        *   **範例**：「我發現你在這堂課有超過一半的時間都在『目視教師』，這代表你非常努力地跟上老師的節奏，非常棒！」

    *   **`observation_points_summary` (行為模式提醒):**
        *   客觀、中性地指出一個或兩個最主要的、可能影響學習的行為模式。避免使用負面詞彙。
        *   **範例**：「數據也顯示，大約有 15% 的時間出現了『玩弄物品』或『目視他處』的狀況，這些時刻可能讓我們不小心錯過了一些重點喔。」

    *   **`reflection_points` (反思引導提問):**
        *   **【此項最為關鍵】** 根據前面的觀察點，設計 2-3 個**開放式問題**，引導學生思考行為背後的原因，而不是直接給答案。
        *   **問題範例 1**：「我們可以一起回想看看，當出現『玩弄物品』的時候，通常是在課程的哪個階段呢？是覺得內容太簡單、太難，還是剛好有點疲倦了呢？」
        *   **問題範例 2**：「當視線看向其他地方時，是想到了什麼有趣的事，還是被教室裡的其他動靜吸引了呢？了解這些原因，能幫助我們找到最適合自己的專注方法。」

    *   **`suggestions` (可實踐的小建議):**
        *   提供 1-2 個**具體、微小、且容易執行**的行動建議。不要說「要專心」，而是給出方法。
        *   **建議範例 1**：「下次當你發現自己開始無意識地轉筆時，可以試著把它輕輕放下，然後做一個深呼吸，再重新將目光移回老師或課本上。」
        *   **建議範例 2**：「如果感覺到疲倦或分心，可以試試看『筆記專注法』：在筆記本上寫下老師說的任何一個關鍵字，這個小動作能幫助我們的大腦重新連線！」

    *   **`encouragement` (鼓勵與結語):**
        *   用一句溫暖、有力的話作結，強調這份報告是幫助他成長的工具。
        *   **範例**：「每一次的觀察都是為了讓我們更了解自己。相信你透過這些小小的調整，一定能發揮出自己最大的潛力，加油！」
    """
    retry_attempts = 2
    for attempt in range(retry_attempts):
        try:
            print(f"  正在為學生 {student_id} 使用 {summary_deployment_name} 生成個性化總結...")
            # ✅ 在 API 呼叫時使用傳入的參數
            response = openai_client.chat.completions.create(
                model=summary_deployment_name, 
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": "你是一位富有同理心和洞察力的教育顧問。"},
                          {"role": "user", "content": prompt_for_summary}],
                max_tokens=MAX_TOKENS_SUMMARY_COMPLETION,
                temperature=0.7
            )

            summary_data = json.loads(response.choices[0].message.content)
            expected_keys = ["greeting", "positive_feedback", "observation_points_summary", "reflection_points", "suggestions", "encouragement"]
            if all(key in summary_data for key in expected_keys): 
                print(f"  成功為學生 {student_id} 生成個性化總結。")
                return summary_data
            else: 
                print(f"    警告：個性化總結JSON缺少鍵。返回: {summary_data}")
                return {key: summary_data.get(key, f"AI未能生成 ({key})") for key in expected_keys}
        except Exception as e: 
            print(f"  生成個性化總結錯誤 ({attempt + 1}): {e}")
            time.sleep(API_RETRY_DELAY_SECONDS if isinstance(e, RateLimitError) else 5)
        if attempt == retry_attempts - 1: 
            print(f"  錯誤：無法為學生 {student_id} 生成個性化總結。")
            return {"greeting": f"親愛的 {student_id},", "positive_feedback": "總結生成遇到問題。", "observation_points_summary": "請參考統計數據。", "reflection_points": "未能生成。", "suggestions": "請自行評估。", "encouragement": "加油！"}
    return {}

def find_closest_image_path(representative_timestamp, sorted_photo_list, max_time_diff_seconds=5):
    """
    一個可重用的輔助函數，用二分查找法在排序好的照片列表中找到時間最接近的照片路徑。
    """
    if not sorted_photo_list:
        return None

    all_timestamps = [item[0] for item in sorted_photo_list]
    # bisect_left 找到應該插入的位置
    insertion_point = bisect.bisect_left(all_timestamps, representative_timestamp)

    closest_path = None
    min_diff = datetime.timedelta.max

    # 只檢查插入點及其前後的幾個候選照片，效率極高
    # 檢查範圍設為 insertion_point-2 到 insertion_point+2 以增加容錯
    start_index = max(0, insertion_point - 2)
    end_index = min(len(sorted_photo_list), insertion_point + 2)

    for i in range(start_index, end_index):
        candidate_ts, candidate_path = sorted_photo_list[i]
        diff = abs(candidate_ts - representative_timestamp)
        if diff < min_diff:
            min_diff = diff
            closest_path = candidate_path

    # 只有在時間差在容許範圍內才返回路徑
    if closest_path and min_diff.total_seconds() <= max_time_diff_seconds:
        return closest_path
    
    return None

def find_closest_position(representative_timestamp, sorted_position_list, max_time_diff_seconds=10):
    """
    用二分查找法在排序好的位置列表中找到時間最接近的老師位置。
    """
    if not sorted_position_list:
        return "未知"

    all_timestamps = [item[0] for item in sorted_position_list]
    insertion_point = bisect.bisect_left(all_timestamps, representative_timestamp)

    closest_position = "未知"
    min_diff = datetime.timedelta.max

    start_index = max(0, insertion_point - 2)
    end_index = min(len(sorted_position_list), insertion_point + 2)

    for i in range(start_index, end_index):
        candidate_ts, candidate_pos = sorted_position_list[i]
        diff = abs(candidate_ts - representative_timestamp)
        if diff < min_diff:
            min_diff = diff
            closest_position = candidate_pos
    
    if min_diff.total_seconds() <= max_time_diff_seconds:
        return closest_position
    
    return "未知"

def process_single_batch(batch_idx, image_batch_info, teacher_positions_data, sorted_classroom_photos, classroom_states, client, student_id, student_position, deployment_names, rag_objects):
    """
    【Multimodal RAG 升級版】
    處理單一圖片批次，並根據視覺相似度動態注入 Few-Shot 範例。
    """
    batch_student_paths = [info["path"] for info in image_batch_info]
    batch_image_filenames = [info["filename"] for info in image_batch_info]
    
    representative_timestamp = image_batch_info[0]["timestamp_obj"]

    # --- 【【【核心修改點：替換為 Multimodal RAG 檢索】】】 ---
    # 使用批次中的第一張圖片作為代表，來進行視覺搜索
    representative_image_path = image_batch_info[0]["path"]
    selected_examples = retrieve_visual_examples_mm_rag(
        image_path=representative_image_path,
        rag_objects=rag_objects,
        # num_examples=NUM_RAG_EXAMPLES  # 您可以調整檢索數量
    )
    # --- 【【【修改結束】】】 ---
    
    few_shot_prompt_str = format_examples_for_prompt(selected_examples)

    # --- 為當前批次查找所有情境數據 (此部分邏輯不變) ---
    teacher_position_text = find_closest_position(representative_timestamp, teacher_positions_data)
    classroom_view_path = find_closest_image_path(representative_timestamp, sorted_classroom_photos)
    classroom_state = find_state_for_timestamp(representative_timestamp, classroom_states)

    # --- 呼叫分析函數 (此部分邏輯不變) ---
    sequence_analysis_data = analyze_student_behavior_from_images_sequence(
        student_image_paths=batch_student_paths,
        teacher_position_text=teacher_position_text,
        classroom_view_image_path=classroom_view_path,
        classroom_state=classroom_state,
        image_filenames_batch=batch_image_filenames,
        openai_client=client,
        student_id=student_id,
        student_position=student_position,
        few_shot_prompt_str=few_shot_prompt_str,
        deployment_names=deployment_names
    )

    # 返回結果的結構保持不變
    return {
        "batch_index": batch_idx,
        "image_batch_info": image_batch_info,
        "matched_teacher_position_text": teacher_position_text,
        "matched_classroom_view_image": os.path.basename(classroom_view_path) if classroom_view_path else None,
        "matched_classroom_state": classroom_state,
        "analysis": sequence_analysis_data
    }

def main_test():
    """
    這個函式僅用於單獨執行此檔案時進行快速測試。
    """
    print("--- 學生分析模組 (單獨測試模式) ---")
    
    # 1. 初始化必要的共用物件
    load_dotenv()
    try:
        client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_KEY"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_version="2024-02-01"
        )
        client.models.list()
        print("Azure OpenAI client 初始化成功。")
    except Exception as e:
        print(f"初始化 Azure OpenAI Client 時發生錯誤: {e}")
        return

    test_deployment_names = {
        'vision': os.getenv("CHAT_COMPLETION_NAME"),
        'summary': os.getenv("CHAT_COMPLETION_NAME")
    }
    print(f"使用模型: {test_deployment_names['vision']}")
    print("-" * 40)

    # 2. 手動收集單一學生的資訊 (請根據您的實際情況修改)
    student_task = {
        'id': '測試學生', 
        'number': 99, 
        'folder': r'C:\Users\User\Desktop\test\student_week_photo\0713\ID_3\Keyframes', #<--請換成一個真實存在的路徑
        'position': '第一排中間', 
        'start_offset': '00:00:00'
    }

    # 3. 手動設定情境路徑
    date_mmdd = input("請輸入情境資料的日期 (MMDD, 例如 0713): ")
    context_paths = {
        'classroom_view': rf'C:\Users\User\Desktop\test\student_full_classroom\{date_mmdd}_english_class',
        'teacher_pos': rf'C:\Users\User\Desktop\test\teacher_position\{date_mmdd}_position.json',
        'classroom_state': rf'C:\Users\User\Desktop\test\SynologyDrive\image\上課影片\{date_mmdd}\老師\TXT\{date_mmdd}.json'
    }
    
    # 4. 呼叫主分析函式進行測試
    try:
        test_report_date = f"{date_mmdd[:2]}/{date_mmdd[2:]}"
        
        # 【【【核心修正】】】 使用新的函數簽名進行呼叫
        result_message = analyze_single_student(
            student_task, 
            client, 
            context_paths, 
            test_report_date,
            test_deployment_names
        )
        print(f"\n✅ 分析完成: {result_message}")
    except Exception as e:
        import traceback
        print(f"\n❌ 執行分析時發生錯誤: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main_test()

if __name__ == "__main__":
    # 當直接執行 student_analyzer.py 這個檔案時，運行測試函式
    main_test()