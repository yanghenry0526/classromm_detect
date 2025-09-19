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
    'c123': os.path.join(BASE_PATH, 'human_annotation_c123.json'),
    'd123': os.path.join(BASE_PATH, 'human_annotation_d123.json')
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
    #    所有 CSS 中的大括號都必須雙寫，以進行轉義
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
        print(f"   (無法自動打開瀏覽器，請手動打開檔案。)")

# =========================================================================
# --- 3. 主分析函數 (重構版) ---
# =========================================================================
def analyze_inter_rater_reliability(rater_files):
    print("--- 標註者間信度分析報告 (動態版) ---\n")

    active_raters = list(rater_files.keys())
    if len(active_raters) < 2:
        print("❌ 錯誤：請在 RATER_FILES 配置中至少提供兩位有效的標註員才能進行比較。")
        return

    # --- 3a. 讀取並預處理數據 ---
    merged_df = None
    for i, (rater_id, file_path) in enumerate(rater_files.items()):
        if not os.path.isfile(file_path):
            print(f"❌ 警告：找不到檔案 {file_path}，將跳過標註員 {rater_id}。")
            active_raters.remove(rater_id)
            continue
        try:
            df = pd.read_json(file_path)
            df['original_ai_confidence'] = df['context'].apply(lambda x: x.get('original_ai_confidence'))
            
            rater_df = df[['image_path', 'corrected_behavior', 'calibration_confidence']].copy()
            rater_df.rename(columns={'corrected_behavior': f'behavior_{rater_id}', 'calibration_confidence': f'confidence_{rater_id}'}, inplace=True)

            if merged_df is None:
                merged_df = df[['image_path', 'original_behavior', 'original_ai_confidence']].copy()
                merged_df.rename(columns={'original_behavior': 'behavior_AI', 'original_ai_confidence': 'confidence_AI'}, inplace=True)
            
            merged_df = pd.merge(merged_df, rater_df, on='image_path', how='inner')
            print(f"✅ 成功讀取並處理標註員 {rater_id} 的 {len(df)} 筆紀錄。")
        except Exception as e:
            print(f"❌ 讀取檔案 {file_path} 時發生嚴重錯誤: {e}")
            
    if merged_df is None or merged_df.empty or len(active_raters) < 2:
        print("\n❌ 合併數據後沒有足夠的共同標註圖片進行分析。")
        return

    print(f"\n在 {len(active_raters)} 位標註員檔案中共找到 {len(merged_df)} 筆共同標註圖片。\n")
    
    # --- 3b. 執行統計分析 ---
    stats_summary = {"基礎統計": {"共同標註圖片總數": f"{len(merged_df)} 筆"}}
    
    # 分析一：人類標註員之間 (兩兩比較)
    human_rater_stats = {}
    if len(active_raters) >= 2:
        for rater1, rater2 in combinations(active_raters, 2):
            kappa = cohen_kappa_score(merged_df[f'behavior_{rater1}'], merged_df[f'behavior_{rater2}'])
            human_rater_stats[f"Cohen's Kappa ({rater1} vs {rater2})"] = f"{kappa:.4f}"
    
    # 如果標註員大於等於2位，才計算 ICC
    long_format_df = pd.melt(merged_df, id_vars=['image_path'], value_vars=[f'confidence_{name}' for name in active_raters], var_name='rater', value_name='rating')
    icc_results = pg.intraclass_corr(data=long_format_df, targets='image_path', raters='rater', ratings='rating').set_index('Type')
    icc_val = icc_results.loc['ICC3k']['ICC']
    human_rater_stats[f"ICC ({', '.join(active_raters)} 信度評分)"] = f"{icc_val:.4f}"
    stats_summary["分析一：人類標註員之間的一致性"] = human_rater_stats

    # 分析二：人類標註員與 AI
    ai_stats = {}
    for rater in active_raters:
        kappa_ai = cohen_kappa_score(merged_df['behavior_AI'], merged_df[f'behavior_{rater}'])
        ai_stats[f"Cohen's Kappa (AI vs {rater})"] = f"{kappa_ai:.4f}"
    stats_summary["分析二：人類標註員與 AI 的一致性"] = ai_stats

    # 打印到終端機
    for group_title, group_stats in stats_summary.items():
        print("-" * 60)
        print(f"【{group_title}】")
        for item_label, item_value in group_stats.items():
            print(f"   {item_label}: {item_value}")
    print("-" * 60)

    # --- 3c. 準備頁籤數據 ---
    # 篩選邏輯需要動態生成
    total_agreement_condition = pd.Series(True, index=merged_df.index)
    any_disagreement_condition = pd.Series(False, index=merged_df.index)
    
    all_behavior_cols = ['behavior_AI'] + [f'behavior_{name}' for name in active_raters]
    for i in range(len(all_behavior_cols) - 1):
        total_agreement_condition &= (merged_df[all_behavior_cols[i]] == merged_df[all_behavior_cols[i+1]])
        any_disagreement_condition |= (merged_df[all_behavior_cols[i]] != merged_df[all_behavior_cols[i+1]])

    df_total_agreement = merged_df[total_agreement_condition]
    df_any_disagreement = merged_df[any_disagreement_condition]
    
    tabs_data = {
        "tab_summary": {"title": "統計摘要"},
        "tab_total_agree": {"title": "所有參與者完全一致", "data": df_total_agreement},
        "tab_any_disagree": {"title": "任何一方不一致", "data": df_any_disagreement},
    }
    
    # 如果有三位標註員，額外增加一個「三方都不同」的頁籤
    if len(active_raters) == 3:
        r1, r2, r3 = active_raters
        df_all_different = merged_df[
            (merged_df[f'behavior_{r1}'] != merged_df[f'behavior_{r2}']) &
            (merged_df[f'behavior_{r2}'] != merged_df[f'behavior_{r3}']) &
            (merged_df[f'behavior_{r1}'] != merged_df[f'behavior_{r3}'])
        ]
        tabs_data["tab_all_different"] = {"title": f"{len(active_raters)}方都不同", "data": df_all_different}

    # --- 3d. 生成報告頁面 ---
    generate_multi_tab_review_page(tabs_data, stats_summary, REVIEW_PAGE_FILENAME, active_raters)

# =========================================================================
# --- 4. 執行分析 ---
# =========================================================================
if __name__ == "__main__":
    analyze_inter_rater_reliability(RATER_FILES)