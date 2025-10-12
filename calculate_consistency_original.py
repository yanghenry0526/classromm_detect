# calculate_consistency.py (v5.0 - 動態多標註員分析版)
import pandas as pd
import numpy as np
from sklearn.metrics import cohen_kappa_score
import pingouin as pg
import os
import json
import webbrowser
from itertools import combinations
# =========================================================================
# --- 1. 配置區 ---
# =========================================================================
BASE_PATH = 'training_json'
# ★★★ 您可以在這裡透過註解 '#' 來動態選擇要分析的標註員 ★★★
RATER_FILES = {
    # 'b123': os.path.join(BASE_PATH, 'human_annotation_b123.json'),
    'c123': os.path.join(BASE_PATH, 'human_annotation_c123_v2.json'),
    'd123': os.path.join(BASE_PATH, 'human_annotation_d123_v2.json')
}
REVIEW_PAGE_FILENAME = 'review_final_report.html'
# =========================================================================
# --- 2. 【強化版】多頁籤審閱頁面生成器 ---
# =========================================================================
def generate_multi_tab_review_page(tabs_data, stats_summary, output_filename, rater_names):
    """生成一個能夠動態適應多位標註員的 HTML 審閱頁面。"""
    # --- 步驟 1: 預先準備好所有需要插入的動態 HTML 內容 ---

    # a. 準備 CSS
    colors = ['#0d6efd', '#dc3545', '#ffc107', '#198754', '#6f42c1']
    rater_css_list = [".rater_AI { color: #6c757d; font-weight: bold; }"]
    for i, name in enumerate(rater_names):
        color = colors[i % len(colors)]
        rater_css_list.append(f".rater_{name} {{ color: {color}; font-weight: bold; }}")
    rater_css = "\n".join(rater_css_list)

    # b. 準備統計摘要內容
    stats_content = '<div class="stats-container">'
    for group_title, group_stats in stats_summary.items():
        stats_content += f'<h2>{group_title}</h2><div class="stats-group">'
        for item_label, item_value in group_stats.items():
            if isinstance(item_value, tuple):
                value, interp = item_value
                stats_content += f'<div class="stats-item"><span class="stats-label">{item_label}</span><div><span class="stats-value">{value}</span><span class="interpretation">({interp})</span></div></div>'
            else:
                stats_content += f'<div class="stats-item"><span class="stats-label">{item_label}</span><span class="stats-value">{item_value}</span></div>'
        stats_content += '</div>'
    stats_content += '</div>'
    tabs_data['tab_summary'] = {"title": "統計摘要", "content": stats_content}

    # c. 準備所有頁籤的按鈕和內容
    tab_buttons_html = ""
    tab_contents_html = ""
    tab_order = list(tabs_data.keys())
    for i, tab_name in enumerate(tab_order):
        tab_info = tabs_data[tab_name]
        is_default = "id='defaultOpen'" if i == 0 else ""
        count = len(tab_info.get('data', [])) if 'data' in tab_info else ""
        button_text = f'{tab_info["title"]}' + (f' ({count})' if count is not None and count != "" else '')
        tab_buttons_html += f'<button class="tab-button" onclick="openTab(event, \'{tab_name}\')" {is_default}>{button_text}</button>'
        
        content = ""
        if 'data' in tab_info:
            df = tab_info['data']
            if df.empty:
                content = f"<p>在此分類下沒有找到任何圖片。</p>"
            else:
                grid_items = []
                all_raters_in_order = ['AI'] + rater_names
                for _, row in df.iterrows():
                    image_path = row['image_path']
                    file_uri = 'file:///' + os.path.abspath(image_path).replace('\\', '/')
                    row_html = ""
                    for rater_id in all_raters_in_order:
                        behavior = row[f'behavior_{rater_id}']
                        confidence_key = f'confidence_{rater_id}'
                        if rater_id == 'AI':
                            confidence = f"{row.get(confidence_key, 0.0):.2f}" if pd.notna(row.get(confidence_key)) else "N/A"
                        else:
                            confidence = f"{row.get(confidence_key, 0):.0f}" if pd.notna(row.get(confidence_key)) else "N/A"
                        row_html += f'<tr><td><strong>{rater_id}</strong></td><td><span class="rater_{rater_id}">{behavior}</span></td><td>{confidence}</td></tr>'
                    grid_items.append(f'<div class="case"><a href="{file_uri}" target="_blank" title="點擊在新分頁中打開原始圖片"><img src="{file_uri}" alt="圖片讀取失敗"></a><table><tr><th>評分者</th><th>行為標籤</th><th>信度分數</th></tr>{row_html}</table><div class="path">{image_path}</div></div>')
                content = '<div class="grid-container">' + "".join(grid_items) + '</div>'
        else:
            content = tab_info['content']
        tab_contents_html += f'<div id="{tab_name}" class="tab-content">{content}</div>'

    # --- 步驟 2: 定義一個純粹的 HTML 模板，只包含佔位符 ---
    #     所有 CSS 中的大括號都必須雙寫，以進行轉義
    html_template = """
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <title>標註一致性與分歧分析報告</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; margin: 0; background-color: #f8f9fa; color: #212529; }}
        .header {{ background-color: #343a40; color: white; padding: 25px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        h1 {{ margin: 0; font-size: 2em; }}
        .main-container {{ padding: 25px; }}
        .tabs {{ border-bottom: 2px solid #dee2e6; margin-bottom: 25px; display: flex; flex-wrap: wrap; }}
        .tabs button {{ background: none; border: none; padding: 12px 22px; cursor: pointer; font-size: 1.1em; font-weight: 600; color: #6c757d; position: relative; bottom: -2px; transition: color 0.2s, border-bottom-color 0.2s; border-bottom: 3px solid transparent; }}
        .tabs button.active {{ color: #0d6efd; border-bottom: 3px solid #0d6efd; }}
        .tab-content {{ display: none; }}
        .tab-content.active {{ display: block; animation: fadeIn 0.5s; }}
        @keyframes fadeIn {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: translateY(0); }} }}
        .grid-container {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 25px; }}
        .case {{ background-color: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }}
        .case img {{ width: 100%; height: auto; border-radius: 4px; margin-bottom: 15px; }}
        .case table {{ width: 100%; border-collapse: collapse; }}
        .case th, .case td {{ padding: 10px; text-align: left; border-bottom: 1px solid #f1f1f1; }}
        .case tr:last-child td {{ border-bottom: none; }}
        .case th {{ width: 30%; color: #495057; font-weight: 600;}}
        .case .path {{ font-family: monospace; font-size: 0.8em; color: #999; word-wrap: break-word; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; }}
        {rater_css}
        .stats-container {{ background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 800px; margin: auto; }}
        .stats-container h2 {{ margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; font-size: 1.5em; color: #343a40; }}
        .stats-group {{ margin-bottom: 35px; }}
        .stats-item {{ display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #f1f1f1; font-size: 1.1em; }}
        .stats-item:last-child {{ border-bottom: none; }}
        .stats-label {{ color: #495057; }}
        .stats-value {{ font-weight: 600; font-size: 1.2em; color: #000; }}
        .interpretation {{ font-size: 0.9em; color: #6c757d; margin-left: 15px; }}
    </style>
</head>
<body>
    <div class="header"><h1>標註一致性與分歧分析報告</h1></div>
    <div class="main-container">
        <div class="tabs">
            {tab_buttons_html}
        </div>
        {tab_contents_html}
    </div>
    <script>
        function openTab(evt, tabName) {{
            document.querySelectorAll(".tab-content").forEach(tc => tc.style.display = "none");
            document.querySelectorAll(".tab-button").forEach(tb => tb.classList.remove("active"));
            document.getElementById(tabName).style.display = "block";
            evt.currentTarget.classList.add("active");
        }}
        document.addEventListener("DOMContentLoaded", function() {{
            const defaultTab = document.getElementById("defaultOpen");
            if (defaultTab) {{ defaultTab.click(); }}
        }});
    </script>
</body>
</html>
"""

    # --- 步驟 3: 在最後一步，一次性地、安全地填充所有佔位符 ---
    final_html = html_template.format(
        rater_css=rater_css,
        tab_buttons_html=tab_buttons_html,
        tab_contents_html=tab_contents_html
    )

    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write(final_html)
    print(f"\n✅ 已生成多頁籤視覺化審閱頁面: {output_filename}")
    try:
        webbrowser.open('file://' + os.path.realpath(output_filename))
    except Exception:
        print(f"    (無法自動打開瀏覽器，請手動打開檔案。)")
# =========================================================================
# --- 3. 主分析函數 (重構版) ---
# =========================================================================
def interpret_kappa(kappa_value):
    """根據 Landis and Koch 的標準解釋 Kappa 分數"""
    if kappa_value > 0.80: return "極好 (Almost Perfect)"
    if kappa_value > 0.60: return "良好 (Substantial)"
    if kappa_value > 0.40: return "中等 (Moderate)"
    if kappa_value > 0.20: return "尚可 (Fair)"
    if kappa_value >= 0.00: return "略微 (Slight)"
    return "差 (Poor)"

def interpret_icc(icc_value):
    """根據 Koo and Li 的標準解釋 ICC 分數"""
    if icc_value >= 0.90: return "極好 (Excellent)"
    if icc_value >= 0.75: return "良好 (Good)"
    if icc_value >= 0.50: return "中等 (Moderate)"
    return "差 (Poor)"

def analyze_inter_rater_reliability(rater_files):
    """
    【v2.0 - 多維度標註分析版】
    讀取並分析多位標註者的 v2 格式標註檔案，計算總體及各維度的一致性。
    """
    print("--- 標註者間信度分析報告 (v2 多維度版) ---\n")
    
    if len(rater_files) < 2:
        print("❌ 錯誤：請在 RATER_FILES 配置中至少提供兩位有效的標註員才能進行比較。")
        return

    # --- 步驟 1: 分別讀取並解析每個標註員的檔案 ---
    all_raters_data = {}
    active_raters = []

    for rater_id, file_path in rater_files.items():
        if not os.path.isfile(file_path):
            print(f"⚠️ 警告：找不到檔案 {file_path}，將跳過標註員 {rater_id}。")
            continue
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            records = []
            for item in data:
                image_path = item.get('image_path')
                confidence = item.get('calibration_confidence')
                # 關鍵：處理新的 corrected_behaviors 物件
                behaviors = item.get('corrected_behaviors', {})
                
                # 將多維度標註展開成多行記錄，每行代表一個維度的標註
                if isinstance(behaviors, dict) and behaviors:
                    for category, behavior in behaviors.items():
                        records.append({
                            'image_path': image_path,
                            'rater': rater_id,
                            'category': category.strip(), # 新增維度欄位，並去除可能存在的空格
                            'behavior': behavior,
                            'confidence': confidence
                        })
                # 兼容舊格式：如果找不到 corrected_behaviors，則嘗試讀取 corrected_behavior
                elif 'corrected_behavior' in item:
                    records.append({
                        'image_path': image_path,
                        'rater': rater_id,
                        'category': '綜合行為', # 給予一個統一的維度名稱
                        'behavior': item.get('corrected_behavior'),
                        'confidence': confidence
                    })

            if not records:
                print(f"⚠️ 警告：檔案 {file_path} 中沒有找到有效的標註紀錄，將跳過標註員 {rater_id}。")
                continue

            all_raters_data[rater_id] = pd.DataFrame(records)
            active_raters.append(rater_id) # 只有成功讀取的才加入 active 列表
            print(f"✅ 成功讀取並解析標註員 {rater_id} 的 {len(data)} 筆紀錄。")
        except Exception as e:
            print(f"❌ 讀取檔案 {file_path} 時發生嚴重錯誤: {e}")

    if len(active_raters) < 2:
        print("\n❌ 未能成功讀取至少兩位標註員的有效數據，無法進行比較。")
        return

    # --- 步驟 2: 合併數據，找出共同標註的【圖片-維度】組合 ---
    # 以第一個成功的標註員為基礎
    base_rater_id = active_raters[0]
    merged_df = all_raters_data[base_rater_id].copy()
    merged_df.rename(columns={'behavior': f'behavior_{base_rater_id}', 'confidence': f'confidence_{base_rater_id}'}, inplace=True)

    # 逐一與其他標註員合併
    for rater_id in active_raters[1:]:
        rater_df = all_raters_data[rater_id].copy()
        rater_df.rename(columns={'behavior': f'behavior_{rater_id}', 'confidence': f'confidence_{rater_id}'}, inplace=True)
        # 合併的關鍵是 image_path 和 category 都必須相同
        merged_df = pd.merge(merged_df, rater_df, on=['image_path', 'category'], how='inner')

    if merged_df.empty:
        print("\n❌ 合併數據後，沒有找到任何由所有參與分析的標註員共同標註過的【圖片-行為維度】組合。")
        return

    # --- 步驟 3: 提取並合併 AI 的原始判斷 ---
    try:
        # 只需從任一標註員的原始檔案中提取 AI 判斷即可
        df_for_ai = pd.read_json(next(iter(rater_files.values())))
        ai_df = df_for_ai[['image_path', 'original_behavior', 'context']].copy()
        ai_df['confidence_AI'] = ai_df['context'].apply(lambda x: x.get('original_ai_confidence', 0.0))
        ai_df.rename(columns={'original_behavior': 'behavior_AI'}, inplace=True)
        # 只保留需要的欄位，並去除重複的 image_path
        ai_df = ai_df[['image_path', 'behavior_AI', 'confidence_AI']].drop_duplicates(subset=['image_path'])
        
        merged_df = pd.merge(merged_df, ai_df, on='image_path', how='left')
    except Exception as e:
        print(f"⚠️ 警告：提取 AI 原始標籤時出錯: {e}。與 AI 的比較可能不完整。")
        merged_df['behavior_AI'] = '獲取失敗'
        merged_df['confidence_AI'] = 0.0

    print(f"\n在 {len(active_raters)} 位標註員檔案中，共找到 {len(merged_df)} 筆可供比較的共同標註【圖片-行為維度】組合。\n")

    # --- 步驟 4: 執行統計分析 ---
    stats_summary = {"基礎統計": {"可比較標註總數": f"{len(merged_df)} 筆"}}

    # 分析一：人類標註員之間
    human_rater_stats = {}
    if len(active_raters) >= 2:
        # 計算總體 Kappa
        for rater1, rater2 in combinations(active_raters, 2):
            kappa = cohen_kappa_score(merged_df[f'behavior_{rater1}'], merged_df[f'behavior_{rater2}'])
            human_rater_stats[f"Cohen's Kappa ({rater1} vs {rater2} - 所有維度)"] = (f"{kappa:.4f}", interpret_kappa(kappa))

        # 按維度計算 Kappa
        for category in sorted(merged_df['category'].unique()):
            # =======================
            # === ★★★ 在此加入修改 ★★★ ===
            # 如果維度名稱是 '其他狀態'，就跳過此迴圈，不進行計算
            if category == '其他狀態':
                continue
            # =======================

            category_df = merged_df[merged_df['category'] == category]
            if len(category_df) < 2: continue
            for rater1, rater2 in combinations(active_raters, 2):
                kappa = cohen_kappa_score(category_df[f'behavior_{rater1}'], category_df[f'behavior_{rater2}'])
                human_rater_stats[f"  └ {category} ({rater1} vs {rater2})"] = (f"{kappa:.4f}", interpret_kappa(kappa))

    # ICC 計算
    long_format_df = pd.melt(merged_df, id_vars=['image_path', 'category'], value_vars=[f'confidence_{name}' for name in active_raters], var_name='rater', value_name='rating')
    icc_results = pg.intraclass_corr(data=long_format_df, targets='image_path', raters='rater', ratings='rating').set_index('Type')
    icc_val = icc_results.loc['ICC3k']['ICC']
    human_rater_stats[f"ICC ({', '.join(active_raters)} 信度評分)"] = (f"{icc_val:.4f}", interpret_icc(icc_val))
    stats_summary["分析一：人類標註員之間的一致性"] = human_rater_stats

    # --- 分析二：【最終版】人類標註員與 AI 的一致性 (按標註員分組，內含信度分層) ---
    ai_stats = {}

    # 將數據集預先根據 AI 的信度分為兩組
    df_low_confidence = merged_df[merged_df['confidence_AI'] < 0.95].copy()
    df_high_confidence = merged_df[merged_df['confidence_AI'] >= 0.95].copy()

    # 以每一位標註員為單位，生成獨立的分析區塊
    for rater in active_raters:
        # 1. 計算總體一致率
        total_agree = (merged_df['behavior_AI'] == merged_df[f'behavior_{rater}']).sum()
        total_count = len(merged_df)
        total_rate = (total_agree / total_count) * 100 if total_count > 0 else 0
        # 標題行
        ai_stats[f"簡易一致率 (AI vs {rater} - 整體)"] = f"{total_rate:.2f}% ({total_agree} / {total_count})"

        # 2. 計算低信度區間的一致率
        low_conf_agree = (df_low_confidence['behavior_AI'] == df_low_confidence[f'behavior_{rater}']).sum()
        low_conf_count = len(df_low_confidence)
        low_conf_rate = (low_conf_agree / low_conf_count) * 100 if low_conf_count > 0 else 0
        # 內容行 - 加上標註員名字以區分
        ai_stats[f"  └ (AI vs {rater}) 信度 < 0.95 時"] = f"{low_conf_rate:.2f}% ({low_conf_agree} / {low_conf_count})"

        # 3. 計算高信度區間的一致率
        high_conf_agree = (df_high_confidence['behavior_AI'] == df_high_confidence[f'behavior_{rater}']).sum()
        high_conf_count = len(df_high_confidence)
        high_conf_rate = (high_conf_agree / high_conf_count) * 100 if high_conf_count > 0 else 0
        # 內容行 - 加上標註員名字以區分
        ai_stats[f"  └ (AI vs {rater}) 信度 >= 0.95 時"] = f"{high_conf_rate:.2f}% ({high_conf_agree} / {high_conf_count})"

    stats_summary["分析二：人類標註員與 AI 的一致性"] = ai_stats

    # 打印統計結果到終端機
    for group_title, group_stats in stats_summary.items():
        print("-" * 60)
        print(f"【{group_title}】")
        for item_label, item_value in group_stats.items():
            if isinstance(item_value, tuple):
                print(f"    {item_label:<45}: {item_value[0]} ({item_value[1]})")
            else:
                print(f"    {item_label:<45}: {item_value}")
    print("-" * 60)

    # --- 步驟 5: 準備 HTML 報告的頁籤數據 ---
    # 篩選出所有參與者（包括AI）行為標籤完全一致的數據
    all_behavior_cols = ['behavior_AI'] + [f'behavior_{name}' for name in active_raters]
    df_total_agreement = merged_df[merged_df[all_behavior_cols].nunique(axis=1) == 1]

    # 篩選出存在任何不一致的數據
    df_any_disagreement = merged_df[merged_df[all_behavior_cols].nunique(axis=1) > 1]

    tabs_data = {
        "tab_summary": {"title": "統計摘要"},
        "tab_total_agree": {"title": "所有參與者完全一致", "data": df_total_agreement},
        "tab_any_disagree": {"title": "任何一方不一致", "data": df_any_disagreement},
    }

    # 如果標註者大於等於 3人，增加一個「人類標註者之間完全不一致」的特殊頁籤
    if len(active_raters) >= 3:
        human_behavior_cols = [f'behavior_{name}' for name in active_raters]
        # 篩選條件：人類標註者的行為標籤種類數 等於 人類標註者的數量
        df_humans_all_different = merged_df[merged_df[human_behavior_cols].nunique(axis=1) == len(active_raters)]
        tabs_data["tab_humans_all_different"] = {"title": f"{len(active_raters)}方人類標註者都不同", "data": df_humans_all_different}

    # --- 步驟 6: 生成最終的 HTML 報告頁面 ---
    generate_multi_tab_review_page(tabs_data, stats_summary, REVIEW_PAGE_FILENAME, active_raters)
# =========================================================================
# --- 4. 執行分析 ---
# =========================================================================
if __name__ == "__main__":
    analyze_inter_rater_reliability(RATER_FILES)