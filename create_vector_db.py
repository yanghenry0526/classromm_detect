# -*- coding: utf-8 -*-

import os
import json
import sys
from PIL import Image
import torch
from transformers import CLIPProcessor, CLIPModel # <--- 改用 transformers
import chromadb
from tqdm import tqdm

# --- 1. 設定區 (與舊程式碼類似) ---
# 您的校準檔案路徑
CALIBRATION_JSON_PATH = r'C:\Users\User\Desktop\test\training_json\calibration_export.json'

# 向量資料庫將被儲存的路徑
DB_PATH = "student_behavior_vectordb"

# ChromaDB 中集合的名稱
COLLECTION_NAME = "behavior_calibrations"

# 【關鍵】使用與您舊程式碼完全相同的模型 ID
MODEL_ID = "openai/clip-vit-base-patch32"

print(f"--- 開始建立/更新視覺知識庫 (CLIP 整合版) ---")

# --- 2. GPU 設備檢查與設定 (直接從舊程式碼移植) ---
if torch.cuda.is_available():
    device = torch.device("cuda")
    gpu_name = torch.cuda.get_device_name(0)
    print(f"✅ GPU 可用: {gpu_name}。將在 GPU 上執行計算。")
else:
    device = torch.device("cpu")
    print("⚠️ GPU 不可用，將在 CPU 上執行計算 (速度會較慢)。")

# --- 3. CLIP 模型載入 (直接從舊程式碼移植) ---
try:
    print(f"正在載入 CLIP 模型 '{MODEL_ID}' (使用 safetensors)...")
    # 【【【核心修改點】】】 在 from_pretrained 中加入 use_safetensors=True
    model = CLIPModel.from_pretrained(MODEL_ID, use_safetensors=True).to(device)
    processor = CLIPProcessor.from_pretrained(MODEL_ID) # Processor 不需要這個參數
    model.eval() # 設置為評估模式
    print(f"✅ CLIP 模型成功載入並移至: {device}")
except Exception as e:
    print(f"❌ 致命錯誤: 載入 CLIP 模型失敗: {e}")
    sys.exit()

# --- 4. 初始化向量資料庫 (不變) ---
client = chromadb.PersistentClient(path=DB_PATH)
collection = client.get_or_create_collection(name=COLLECTION_NAME)
print(f"✅ 向量資料庫 '{DB_PATH}' 初始化成功。")
print("-" * 50)

# --- 5. 讀取 calibration_export.json (不變) ---
if not os.path.isfile(CALIBRATION_JSON_PATH):
    print(f"❌ 錯誤: 找不到校準檔案於 {CALIBRATION_JSON_PATH}")
    sys.exit()

with open(CALIBRATION_JSON_PATH, 'r', encoding='utf-8') as f:
    calibration_data = json.load(f)

print(f"找到 {len(calibration_data)} 筆校準紀錄，開始生成向量並存入資料庫...")

# --- 6. 遍歷、生成向量並存儲 ---
# 我們將使用一個批次處理的邏輯來最大化 GPU 效率
batch_size = 32  # 您可以根據您的 GPU 記憶體大小調整
records_to_process = []

# 先收集所有有效的圖片路徑和元數據
for record in calibration_data:
    image_path = record.get("image_path")
    if image_path and os.path.isfile(image_path):
        records_to_process.append(record)
    else:
        print(f"⚠️ 警告: 找不到圖片 {image_path}，已跳過。")

# 使用批次處理來生成向量
for i in tqdm(range(0, len(records_to_process), batch_size), desc="生成向量進度"):
    batch_records = records_to_process[i:i+batch_size]
    batch_images = []
    batch_ids = []
    batch_metadatas = []

    for record in batch_records:
        try:
            img = Image.open(record["image_path"]).convert("RGB")
            batch_images.append(img)
            batch_ids.append(record["image_path"])

            # --- 【【【核心修改點】】】 ---
            # 1. 創建一個 record 的副本，避免修改原始數據
            metadata_to_store = record.copy()
            
            # 2. 遍歷副本中的所有鍵值對
            for key, value in metadata_to_store.items():
                # 3. 如果值的類型是字典 (dict)
                if isinstance(value, dict):
                    # 4. 就將它轉換成 JSON 格式的字串
                    metadata_to_store[key] = json.dumps(value, ensure_ascii=False)
            
            # 5. 將處理過的 metadata 附加到批次中
            batch_metadatas.append(metadata_to_store)
        except Exception as e:
            print(f"❌ 讀取圖片 {record['image_path']} 時發生錯誤: {e}")
            continue

    if not batch_images:
        continue

    # 【核心】使用 CLIP 模型進行批次處理
    try:
        inputs = processor(images=batch_images, return_tensors="pt").to(device)
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)
        
        # L2 歸一化 (與您舊程式碼邏輯保持一致)
        norm_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
        
        # 將 Tensor 轉換回 CPU 上的 list
        embeddings = norm_features.cpu().numpy().tolist()

        # 將整個批次的結果存入資料庫
        collection.upsert(
            embeddings=embeddings,
            metadatas=batch_metadatas,
            ids=batch_ids
        )
    except Exception as e:
        print(f"❌ 處理批次 {i//batch_size + 1} 時發生錯誤: {e}")


print("\n🎉 --- 視覺知識庫建立/更新完畢 --- 🎉")
print(f"資料庫中現在共有 {collection.count()} 筆紀錄。")