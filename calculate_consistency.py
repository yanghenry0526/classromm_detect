# calculate_consistency.py (v5.2 - 混合分析與視覺美化版)
import pandas as pd
import numpy as np
from sklearn.metrics import cohen_kappa_score
import simpledorff
import krippendorff
import pingouin as pg
import os
import json
import webbrowser
from itertools import combinations

# =========================================================================
# --- 新增：行為類別定義 ---
# =========================================================================
BEHAVIOR_CATEGORIES_GROUPED = {
    "視線": ["目視教師", "目視黑板", "目視書本/筆記", "目視同學", "目視他處"],
    "肢體(手部)": ["做筆記", "翻書", "觸摸臉部", "觸摸頭髮", "托腮"],
    "身體姿態": ["坐姿直立", "身體前傾", "身體後靠", "低頭(非學習)", "趴睡"],
    "互動": ["主動舉手", "被動舉手"],
    "其他狀態": ["喝水", "飲食", "玩弄手部/文具", "被遮擋/無法判斷"]
}

# 建立一個反向查找字典，以便從行為快速找到其類別
BEHAVIOR_TO_CATEGORY = {behavior: category 
                        for category, behaviors in BEHAVIOR_CATEGORIES_GROUPED.items() 
                        for behavior in behaviors}

# =========================================================================
# --- 恢復：視線子類別定義 (v5.2) ---
# 為「視線」類別的特殊分析邏輯重新引入
# =========================================================================
GAZE_UP_FORWARD = ["目視教師", "目視黑板"]
GAZE_DOWN_SURROUND = ["目視書本/筆記", "目視同學", "目視他處"]
 
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

# --- v6.0 新增配置 ---
# AI 信心分數的分層閾值
USE_CONFIDENCE_GATE_FOR_ALPHA = True
ALPHA_CONFIDENCE_THRESHOLD = 0.95 # AI 信心分數的閾值
# "無法判斷" 的具體標籤名稱，需要與 BEHAVIOR_CATEGORIES_GROUPED 中定義的完全一致
UNJUDGABLE_LABEL = "被遮擋/無法判斷"

def normalize_to_list(behavior_data):
    """
    將傳入的行為標註統一轉換為列表格式。
    """
    if isinstance(behavior_data, list):
        return behavior_data
    if isinstance(behavior_data, str):
        return [behavior_data]
    return []

def calculate_multilabel_metrics(series1, series2, all_labels):
    """
    計算兩個多標籤 Series 之間的一致性指標。
    """
    if len(series1) != len(series2):
        raise ValueError("兩個 Series 的長度必須相同。")
    if len(series1) == 0:
        return {
            'partial_agreement_rate': (0, 0, 0),
            'mean_kappa': 0.0,
            'labelwise_kappas': {}
        }

    # 1. 計算部分一致率
    agreements = 0
    for s1, s2 in zip(series1, series2):
        if set(s1) & set(s2):
            agreements += 1
    total_items = len(series1)
    partial_rate = (agreements / total_items) * 100 if total_items > 0 else 0
    
    # 2. 計算平均 Kappa
    label_kappas = {}
    valid_kappas = []
    
    for label in all_labels:
        s1_binary = series1.apply(lambda x: 1 if label in x else 0)
        s2_binary = series2.apply(lambda x: 1 if label in x else 0)
        
        if s1_binary.sum() > 0 or s2_binary.sum() > 0:
            kappa = cohen_kappa_score(s1_binary, s2_binary)
            label_kappas[label] = kappa
            valid_kappas.append(kappa)
            
    mean_kappa = np.mean(valid_kappas) if valid_kappas else 0.0
    
    return {
        'partial_agreement_rate': (partial_rate, agreements, total_items),
        'mean_kappa': mean_kappa,
        'labelwise_kappas': label_kappas
    }

def calculate_sub_alpha(sub_long_format_data, summary_dict, label_name):
    """
    一個輔助函式，專門用來計算子類別的 Krippendorff's Alpha。
    接收長格式數據、結果字典和標籤名稱，執行完整的計算流程。
    """
    if not sub_long_format_data:
        summary_dict[label_name] = "樣本不足"
        return

    df = pd.DataFrame(sub_long_format_data, columns=['doc', 'rater', 'label'])
    df.drop_duplicates(subset=['doc', 'rater'], inplace=True)
    
    doc_rater_counts = df.groupby('doc')['rater'].nunique()
    valid_docs = doc_rater_counts[doc_rater_counts >= 2].index
    df = df[df['doc'].isin(valid_docs)]

    if df.empty:
        summary_dict[label_name] = "樣本不足"
        return
        
    if df['label'].nunique() <= 1:
        summary_dict[label_name] = ("1.0000*", "完美一致")
        return
    
    try:
        pivoted_df = df.pivot(index='doc', columns='rater', values='label')
        reliability_data = [list(row) for row in pivoted_df.to_numpy().T]
        alpha = krippendorff.alpha(reliability_data=reliability_data, level_of_measurement='nominal')

        if np.isnan(alpha):
            summary_dict[label_name] = "無法計算"
        else:
            summary_dict[label_name] = (f"{alpha:.4f}", interpret_alpha(alpha))
    except Exception as e:
        summary_dict[label_name] = "無法計算"
# =========================================================================
# --- 2. 【v5.2 視覺美化版】多頁籤審閱頁面生成器 ---
# =========================================================================
# =========================================================================
# --- 2. 【v5.2 + Highlight】多頁籤審閱頁面生成器 ---
# =========================================================================
def generate_multi_tab_review_page(tabs_data, stats_summary, output_filename, rater_names):
    """
    【v5.2 + Highlight - 視覺美化版】
    - 引入卡片式設計來呈現統計摘要，增強可讀性。
    - 修改了 HTML 和 CSS 結構以支持新的佈局。
    - 【新增】對大於等於 0.7 的數值進行背景高亮顯示。
    """
    
    # <--- 修改開始: 新增一個輔助函式來判斷是否需要高亮 ---
    def get_highlight_class(value_obj):
        """根據傳入的值，判斷是否要返回 'highlight' CSS class。"""
        numeric_str = None
        # 處理元組 (e.g., ("0.8409", "良好"))
        if isinstance(value_obj, tuple):
            numeric_str = value_obj[0]
        # 處理字串 (e.g., "91.14% (648/711)")
        elif isinstance(value_obj, str):
            numeric_str = value_obj.split(' ')[0].replace('%', '')

        if numeric_str:
            try:
                numeric_val = float(numeric_str)
                # 判斷是否為百分比
                is_percentage = isinstance(value_obj, str) and '%' in value_obj
                
                if is_percentage and numeric_val >= 70:
                    return 'highlight'
                if not is_percentage and numeric_val >= 0.7:
                    return 'highlight'
            except (ValueError, TypeError):
                # 如果無法轉換為數字 (例如 "樣本不足")，則忽略
                pass
        return '' # 預設返回空字串，無高亮
    # <--- 修改結束: 輔助函式定義完畢 ---

    colors = ['#0d6efd', '#dc3545', '#ffc107', '#198754', '#6f42c1', '#fd7e14', '#20c997']
    # ... (後續程式碼不變) ...
    rater_css_list = [".rater_AI { color: #6c757d; font-weight: bold; }"]
    for i, name in enumerate(rater_names):
        color = colors[i % len(colors)]
        rater_css_list.append(f".rater_{name} {{ color: {color}; font-weight: bold; }}")
    rater_css = "\n".join(rater_css_list)

    stats_content = '<div class="stats-container">'
    for group_title, group_data in stats_summary.items():
        stats_content += f'<h2>{group_title}</h2>'
        
        if group_title == "分析二：標註員與 AI 的一致性" and isinstance(group_data, dict):
            for rater_title, rater_stats in group_data.items():
                stats_content += f'<h3 class="rater-subtitle">{rater_title}</h3>'
                
                current_card_open = False
                for item_label, item_value in rater_stats.items():
                    if item_label.strip().startswith('└ Kappa'):
                        if current_card_open:
                            stats_content += '</div>'
                        stats_content += '<div class="category-card">'
                        current_card_open = True
                        
                        highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                        value_html = ""
                        if isinstance(item_value, tuple):
                            value, interp = item_value
                            value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                        elif item_value != "":
                             value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                        
                        stats_content += f'<div class="stats-item main-category-item"><span class="stats-label">{item_label.strip()}</span>{value_html}</div>'

                    elif item_label.strip().startswith('├─') or item_label.strip().startswith('└─'):
                        highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                        value_html = ""
                        if isinstance(item_value, tuple):
                            value, interp = item_value
                            value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                        elif item_value != "":
                             value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                        
                        stats_content += f'<div class="stats-item sub-category-item"><span class="stats-label">{item_label.strip()}</span>{value_html}</div>'
                    
                    else:
                        if current_card_open:
                           stats_content += '</div>'
                           current_card_open = False
                        
                        if item_label.startswith("---"):
                            stats_content += f'<h4 class="category-subtitle">{item_label}</h4>'
                        elif item_value != "":
                            highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                            value_html = ""
                            if isinstance(item_value, tuple):
                                value, interp = item_value
                                value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                            else:
                                value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                            stats_content += f'<div class="stats-item"><span class="stats-label">{item_label}</span>{value_html}</div>'

                if current_card_open:
                    stats_content += '</div>'

        else: 
            current_card_open = False
            for item_label, item_value in group_data.items():
                if item_label.strip().startswith('└ Kappa') or item_label.strip().startswith('Alpha ('): # <--- 修改: 增加對 Alpha 的判斷
                    if current_card_open and not item_label.strip().startswith('Alpha ('):
                        stats_content += '</div>'
                    if not item_label.strip().startswith('Alpha ('):
                        stats_content += '<div class="category-card">'
                        current_card_open = True
                    
                    highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                    value_html = ""
                    if isinstance(item_value, tuple):
                        value, interp = item_value
                        value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                    elif item_value != "":
                         value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                    stats_content += f'<div class="stats-item main-category-item"><span class="stats-label">{item_label.strip()}</span>{value_html}</div>'

                elif item_label.strip().startswith('├─') or item_label.strip().startswith('└─'):
                    highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                    value_html = ""
                    if isinstance(item_value, tuple):
                        value, interp = item_value
                        value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                    elif item_value != "":
                         value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                    stats_content += f'<div class="stats-item sub-category-item"><span class="stats-label">{item_label.strip()}</span>{value_html}</div>'
                else:
                    if current_card_open:
                       stats_content += '</div>'
                       current_card_open = False
                    if item_label.startswith("---"):
                        stats_content += f'<h4 class="category-subtitle">{item_label}</h4>'
                    elif item_value != "":
                        highlight_class = get_highlight_class(item_value) # <--- 修改: 呼叫輔助函式
                        value_html = ""
                        if isinstance(item_value, tuple):
                            value, interp = item_value
                            value_html = f'<div><span class="stats-value {highlight_class}">{value}</span><span class="interpretation">({interp})</span></div>'
                        else:
                            value_html = f'<span class="stats-value {highlight_class}">{item_value}</span>'
                        stats_content += f'<div class="stats-item"><span class="stats-label">{item_label}</span>{value_html}</div>'

            if current_card_open:
                stats_content += '</div>'
        
    stats_content += '</div>'
    tabs_data['tab_summary'] = {"title": "統計摘要", "content": stats_content}

    # ... (中段的 tab_buttons_html 和 tab_contents_html 生成邏輯保持不變) ...
    tab_buttons_html = ""
    tab_contents_html = ""
    tab_order = ['tab_summary'] + [key for key in tabs_data if key != 'tab_summary']
    
    for i, tab_name in enumerate(tab_order):
        tab_info = tabs_data[tab_name]
        is_default = "id='defaultOpen'" if i == 0 else ""
        
        count_str = ""
        if 'data' in tab_info and tab_info['data'] is not None:
            count = len(tab_info['data'])
            count_str = f' ({count})'

        button_text = f'{tab_info["title"]}{count_str}'
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
                        behavior_data = row.get(f'behavior_{rater_id}', {})
                        
                        if isinstance(behavior_data, dict):
                            behavior_str = ', '.join(behavior_data.values()) if behavior_data else '<i>(未標註)</i>'
                        elif isinstance(behavior_data, list):
                            behavior_str = ', '.join(map(str, behavior_data)) if behavior_data else '<i>(AI未標註)</i>'
                        elif pd.notna(behavior_data):
                            behavior_str = str(behavior_data)
                        else:
                            behavior_str = '<i>(未標註)</i>'

                        confidence_key = f'confidence_{rater_id}'
                        confidence_val = row.get(confidence_key)
                        
                        if pd.notna(confidence_val):
                            if rater_id == 'AI':
                                confidence_str = f"{confidence_val:.2f}"
                            else:
                                confidence_str = f"{confidence_val:.0f}"
                        else:
                            confidence_str = "N/A"
                            
                        row_html += f'<tr><td><strong>{rater_id}</strong></td><td><span class="rater_{rater_id}">{behavior_str}</span></td><td>{confidence_str}</td></tr>'

                    grid_items.append(f'<div class="case"><a href="{file_uri}" target="_blank" title="點擊在新分頁中打開原始圖片"><img src="{file_uri}" alt="圖片讀取失敗"></a><table><tr><th>評分者</th><th>行為標籤</th><th>信度分數</th></tr>{row_html}</table><div class="path">{image_path}</div></div>')
                content = '<div class="grid-container">' + "".join(grid_items) + '</div>'
        else:
            content = tab_info.get('content', '')
            
        tab_contents_html += f'<div id="{tab_name}" class="tab-content">{content}</div>'

    # --- HTML 模板 ---
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
            .case img {{ width: 100%; height: auto; border-radius: 4px; margin-bottom: 15px; aspect-ratio: 16 / 9; object-fit: cover; }}
            .case table {{ width: 100%; border-collapse: collapse; }}
            .case th, .case td {{ padding: 10px; text-align: left; border-bottom: 1px solid #f1f1f1; }}
            .case tr:last-child td {{ border-bottom: none; }}
            .case th {{ width: 25%; color: #495057; font-weight: 600;}}
            .case .path {{ font-family: monospace; font-size: 0.8em; color: #999; word-wrap: break-word; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; }}
            {rater_css}
            .stats-container {{ background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 800px; margin: auto; }}
            .stats-container h2 {{ margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; font-size: 1.5em; color: #343a40; }}
            .rater-subtitle {{ margin-top: 30px; margin-bottom: 15px; font-size: 1.25em; color: #495057; border-left: 4px solid #0d6efd; padding-left: 10px; }}
            .category-subtitle {{ margin-top: 25px; margin-bottom: 10px; font-size: 1.1em; font-weight: 600; color: #6c757d; }}
            .category-card {{ border: 1px solid #dee2e6; border-radius: 8px; margin-top: 20px; margin-bottom: 20px; background-color: #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }}
            .stats-item {{ display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #f1f1f1; font-size: 1.05em; }}
            .category-card .stats-item:last-child {{ border-bottom: none; }}
            .main-category-item {{ background-color: #f8f9fa; font-weight: 600; border-bottom: 1px solid #dee2e6; padding-top: 16px; padding-bottom: 16px; }}
            .main-category-item .stats-label {{ font-size: 1.1em; color: #212529; }}
            .sub-category-item {{ padding-left: 40px; }}
            .sub-category-item .stats-label {{ color: #495057; }}
            .stats-label {{ color: #495057; }}
            .stats-value {{ font-weight: 600; font-size: 1.15em; color: #000; }}
            .interpretation {{ font-size: 0.9em; color: #6c757d; margin-left: 10px; }}

            /* <--- 修改開始: 新增 highlight CSS 樣式 --- */
            .highlight {{
                background-color: #fff3cd; /* 使用一個柔和的黃色 */
                color: #664d03; /* 深色文字以確保可讀性 */
                padding: 3px 8px;
                border-radius: 5px;
                font-weight: 700;
                display: inline-block; /* 讓背景色包圍文字 */
            }}
            /* <--- 修改結束 --- */
        </style>
    </head>
    <body>
    <!-- ... (後續的 body 內容不變) ... -->
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

# --- 3. 主分析函數 (v5.2 混合分析版) ---
# =========================================================================
def interpret_kappa(kappa_value):
    """根據 Landis and Koch 的標準解釋 Kappa 分數"""
    if kappa_value > 0.80: return "極好 (Almost Perfect)"
    if kappa_value > 0.60: return "良好 (Substantial)"
    if kappa_value > 0.40: return "中等 (Moderate)"
    if kappa_value > 0.20: return "尚可 (Fair)"
    if kappa_value >= 0.00: return "略微 (Slight)"
    return "差 (Poor)"

def interpret_alpha(alpha_value):
    """根據 Krippendorff 的標準解釋 Alpha 分數"""
    if alpha_value >= 0.800: return "良好 (Good)"
    if alpha_value >= 0.667: return "尚可 (Fair)"
    return "差 (Poor)"

def analyze_inter_rater_reliability(rater_files):
    """
    【v5.3.1 - TypeError Bug Fix (完整版)】
    - 修正了在分析三中，因標籤列表混雜 NoneType 和 str 導致 sorted() 函式報錯的問題。
    - 包含分析一 (人 vs 人)、分析二 (人 vs AI)、分析三 (AI vs 人類共識)。
    - 對「視線」類別採用分組子類別分析，其他類別逐項分析。
    """
    print("--- 標註者間信度分析報告 (v5.3.1 Bug Fix) ---\n")

    # --- 步驟 1, 2, 3: 數據讀取、整合與篩選 ---
    active_raters = [r for r, path in rater_files.items() if os.path.isfile(path)]
    if len(active_raters) < 2:
        print("❌ 錯誤：請在 RATER_FILES 中至少提供兩位有效的標註員檔案。")
        return

    rater_data, all_image_paths = {}, set()
    for rater_id in active_raters:
        try:
            with open(rater_files[rater_id], 'r', encoding='utf-8') as f: data = json.load(f)
            processed_data = {item['image_path']: {k.strip(): v for k, v in item.get('corrected_behaviors', {}).items()} for item in data if item.get('image_path') and isinstance(item.get('corrected_behaviors'), dict)}
            rater_data[rater_id] = processed_data
            all_image_paths.update(processed_data.keys())
            print(f"✅ 成功讀取標註員 {rater_id} 的 {len(processed_data)} 筆數據。")
        except Exception as e:
            print(f"❌ 讀取檔案 {rater_files[rater_id]} 時發生錯誤: {e}")
            return

    ai_data = {}
    try:
        with open(rater_files[active_raters[0]], 'r', encoding='utf-8') as f: raw_data = json.load(f)
        ai_data = {item['image_path']: {'behavior': normalize_to_list(item.get('original_behavior')), 'confidence': item.get('context', {}).get('original_ai_confidence', 0.0)} for item in raw_data if item.get('image_path')}
        print(f"✅ 成功提取 AI 的 {len(ai_data)} 筆原始標註。")
    except Exception as e:
        print(f"⚠️ 警告：提取 AI 原始標籤時出錯: {e}。")

    df_records = [{'image_path': img, **{f'behavior_{r}': rater_data.get(r, {}).get(img, {}) for r in active_raters}, 'behavior_AI': ai_data.get(img, {}).get('behavior', []), 'confidence_AI': ai_data.get(img, {}).get('confidence', 0.0)} for img in sorted(list(all_image_paths))]
    full_df = pd.DataFrame(df_records)
    
    common_df = full_df.copy()
    for rater in active_raters:
        common_df = common_df[common_df[f'behavior_{rater}'].apply(bool)]
    num_common_images = len(common_df)

    if num_common_images == 0:
        print("\n❌ 沒有找到任何由所有參與分析的標註員共同標註過的圖片。")
        return
    print(f"\n在 {len(active_raters)} 位標註員中，共找到 {num_common_images} 張共同標註過的圖片進行分析。\n")
    
    all_unique_labels = sorted(list(set(label for rater_col in common_df.columns if 'behavior' in rater_col for labels in common_df[rater_col] for label in (labels if isinstance(labels, list) else labels.values()) if label is not None)))
    stats_summary = {"基礎統計": {"共同標註圖片總數": f"{num_common_images} 張"}}

    # --- 分析一：人類標註員之間 ---
    human_rater_stats = {}
    if len(active_raters) >= 2:
        for rater1, rater2 in combinations(active_raters, 2):
            s1_flat = common_df[f'behavior_{rater1}'].apply(lambda d: list(d.values()))
            s2_flat = common_df[f'behavior_{rater2}'].apply(lambda d: list(d.values()))
            
            rate, agreements, total = calculate_multilabel_metrics(s1_flat, s2_flat, all_unique_labels)['partial_agreement_rate']
            human_rater_stats[f"Kappa ({rater1} vs {rater2} - 整體)"] = f"{rate:.2f}% ({agreements}/{total})"
            human_rater_stats[f"--- {rater1} vs {rater2} 分類一致性 ---"] = ""

            for category, behaviors in BEHAVIOR_CATEGORIES_GROUPED.items():
                s1_cat = common_df[f'behavior_{rater1}'].apply(lambda d: d.get(category))
                s2_cat = common_df[f'behavior_{rater2}'].apply(lambda d: d.get(category))
                temp_df = pd.DataFrame({'r1': s1_cat, 'r2': s2_cat}).dropna()
                
                if len(temp_df) > 1 and (len(temp_df['r1'].unique()) > 1 or len(temp_df['r2'].unique()) > 1):
                    kappa = cohen_kappa_score(temp_df['r1'], temp_df['r2'])
                    human_rater_stats[f"  └ Kappa ({category})"] = (f"{kappa:.4f}", interpret_kappa(kappa))

                    if category == "視線":
                        s1_gaze_up = temp_df['r1'].isin(GAZE_UP_FORWARD)
                        s2_gaze_up = temp_df['r2'].isin(GAZE_UP_FORWARD)
                        if (s1_gaze_up | s2_gaze_up).sum() > 1:
                            kappa_up = cohen_kappa_score(s1_gaze_up, s2_gaze_up)
                            human_rater_stats[f"    ├─ Kappa (老師/黑板)"] = (f"{kappa_up:.4f}", interpret_kappa(kappa_up))
                        else:
                            human_rater_stats[f"    ├─ Kappa (老師/黑板)"] = "樣本不足"
                        
                        s1_gaze_down = temp_df['r1'].isin(GAZE_DOWN_SURROUND)
                        s2_gaze_down = temp_df['r2'].isin(GAZE_DOWN_SURROUND)
                        if (s1_gaze_down | s2_gaze_down).sum() > 1:
                            kappa_down = cohen_kappa_score(s1_gaze_down, s2_gaze_down)
                            human_rater_stats[f"    └─ Kappa (書本/同學/他處)"] = (f"{kappa_down:.4f}", interpret_kappa(kappa_down))
                        else:
                             human_rater_stats[f"    └─ Kappa (書本/同學/他處)"] = "樣本不足"
                    else:
                        for behavior in behaviors:
                            s1_binary = temp_df['r1'] == behavior
                            s2_binary = temp_df['r2'] == behavior
                            if s1_binary.sum() > 0 or s2_binary.sum() > 0:
                                kappa_sub = cohen_kappa_score(s1_binary, s2_binary)
                                human_rater_stats[f"    └─ Kappa ({behavior})"] = (f"{kappa_sub:.4f}", interpret_kappa(kappa_sub))
                            else:
                                human_rater_stats[f"    └─ Kappa ({behavior})"] = "樣本不足"
                else:
                    human_rater_stats[f"  └ Kappa ({category})"] = "樣本不足/無法計算"
    stats_summary["【分析一：標註員之間的kappa和ICC】"] = human_rater_stats
    
    # --- 分析二：人類標註員與 AI 的一致性 ---
    if ai_data:
        analysis2_summary = {}
        for rater in active_raters:
            rater_vs_ai_stats = {}
            rater_flat = common_df[f'behavior_{rater}'].apply(lambda d: list(d.values()))
            rate, agreements, total = calculate_multilabel_metrics(rater_flat, common_df['behavior_AI'], all_unique_labels)['partial_agreement_rate']
            rater_vs_ai_stats[f"Kappa ({rater} vs AI - 整體)"] = f"{rate:.2f}% ({agreements}/{total})"

            rater_vs_ai_stats[f"--- {rater} vs AI 分類一致性 (Kappa) ---"] = ""
            for category, behaviors in BEHAVIOR_CATEGORIES_GROUPED.items():
                human_choice = common_df[f'behavior_{rater}'].apply(lambda d: d.get(category))
                ai_choice = common_df['behavior_AI'].apply(lambda l: next((b for b in l if BEHAVIOR_TO_CATEGORY.get(b) == category), None))
                temp_df = pd.DataFrame({'human': human_choice, 'ai': ai_choice}).dropna()

                if len(temp_df) > 1 and (len(temp_df['human'].unique()) > 1 or len(temp_df['ai'].unique()) > 1):
                    kappa = cohen_kappa_score(temp_df['human'], temp_df['ai'])
                    rater_vs_ai_stats[f"  └ Kappa ({category})"] = (f"{kappa:.4f}", interpret_kappa(kappa))
                    
                    if category == "視線":
                        human_up = temp_df['human'].isin(GAZE_UP_FORWARD)
                        ai_up = temp_df['ai'].isin(GAZE_UP_FORWARD)
                        if (human_up | ai_up).sum() > 1:
                            rater_vs_ai_stats[f"    ├─ Kappa (老師/黑板)"] = (f"{cohen_kappa_score(human_up, ai_up):.4f}", interpret_kappa(cohen_kappa_score(human_up, ai_up)))
                        else:
                            rater_vs_ai_stats[f"    ├─ Kappa (老師/黑板)"] = "樣本不足"

                        human_down = temp_df['human'].isin(GAZE_DOWN_SURROUND)
                        ai_down = temp_df['ai'].isin(GAZE_DOWN_SURROUND)
                        if (human_down | ai_down).sum() > 1:
                            rater_vs_ai_stats[f"    └─ Kappa (書本/同學/他處)"] = (f"{cohen_kappa_score(human_down, ai_down):.4f}", interpret_kappa(cohen_kappa_score(human_down, ai_down)))
                        else:
                            rater_vs_ai_stats[f"    └─ Kappa (書本/同學/他處)"] = "樣本不足"
                    else:
                        for behavior in behaviors:
                            human_binary = temp_df['human'] == behavior
                            ai_binary = temp_df['ai'] == behavior
                            if human_binary.sum() > 0 or ai_binary.sum() > 0:
                                kappa_sub = cohen_kappa_score(human_binary, ai_binary)
                                rater_vs_ai_stats[f"    └─ Kappa ({behavior})"] = (f"{kappa_sub:.4f}", interpret_kappa(kappa_sub))
                            else:
                                rater_vs_ai_stats[f"    └─ Kappa ({behavior})"] = "樣本不足"
                else:
                    rater_vs_ai_stats[f"  └ Kappa ({category})"] = "樣本不足/無法計算"
            analysis2_summary[f"--- {rater} vs AI 一致性 ---"] = rater_vs_ai_stats
        stats_summary["分析二：標註員與 AI 的一致性"] = analysis2_summary

    # --- 分析三：AI vs 人類共識 (Human Consensus) ---
    if len(active_raters) == 2 and ai_data:
        rater1, rater2 = active_raters
        analysis3_summary = {}
        
        df_consensus = common_df.copy()
        df_consensus['human_consensus'] = df_consensus.apply(
            lambda row: {cat: row[f'behavior_{rater1}'].get(cat)
                         for cat in BEHAVIOR_CATEGORIES_GROUPED
                         if row[f'behavior_{rater1}'].get(cat) == row[f'behavior_{rater2}'].get(cat)},
            axis=1
        )
        df_consensus = df_consensus[df_consensus['human_consensus'].apply(bool)]
        
        num_consensus_images = len(df_consensus)
        if num_common_images > 0:
            analysis3_summary["達成共識圖片總數"] = f"{num_consensus_images} / {num_common_images} ({num_consensus_images/num_common_images:.2%})"
        else:
            analysis3_summary["達成共識圖片總數"] = "0 / 0 (N/A)"
        
        consensus_flat = df_consensus['human_consensus'].apply(lambda d: list(d.values()))
        ai_flat_consensus = df_consensus['behavior_AI']
        
        # <<< 核心 Bug 修正處：在收集標籤時過濾掉 None >>>
        all_labels_consensus = sorted(list(
            set(l for ls in consensus_flat for l in ls if l is not None) | 
            set(l for ls in ai_flat_consensus for l in ls if l is not None)
        ))
        # <<< 修正結束 >>>
        
        rate, agreements, total = calculate_multilabel_metrics(consensus_flat, ai_flat_consensus, all_labels_consensus)['partial_agreement_rate']
        analysis3_summary["Kappa (AI vs 共識 - 整體)"] = f"{rate:.2f}% ({agreements}/{total})"
        analysis3_summary["--- AI vs 人類共識 分類一致性 ---"] = ""

        for category, behaviors in BEHAVIOR_CATEGORIES_GROUPED.items():
            consensus_choice = df_consensus['human_consensus'].apply(lambda d: d.get(category))
            ai_choice = df_consensus['behavior_AI'].apply(lambda l: next((b for b in l if BEHAVIOR_TO_CATEGORY.get(b) == category), None))
            temp_df = pd.DataFrame({'consensus': consensus_choice, 'ai': ai_choice}).dropna(subset=['consensus'])
            
            # 檢查是否有足夠的數據來計算主類別 Kappa
            if len(temp_df) > 1 and len(temp_df['consensus'].unique()) > 1 and len(temp_df.dropna(subset=['ai'])['ai'].unique()) > 1:
                kappa = cohen_kappa_score(temp_df['consensus'], temp_df['ai'].fillna("NO_AI_LABEL"))
                analysis3_summary[f"  └ Kappa ({category})"] = (f"{kappa:.4f}", interpret_kappa(kappa))

                # --- 類別內部展開分析 ---
                # 1. 對「視線」類別進行特殊分組處理
                if category == "視線":
                    consensus_up = temp_df['consensus'].isin(GAZE_UP_FORWARD)
                    ai_up = temp_df['ai'].isin(GAZE_UP_FORWARD)
                    if (consensus_up | ai_up).sum() > 1 and len(temp_df[consensus_up | ai_up]['ai'].unique()) > 1 :
                        kappa_up = cohen_kappa_score(consensus_up, ai_up)
                        analysis3_summary[f"    ├─ Kappa (老師/黑板)"] = (f"{kappa_up:.4f}", interpret_kappa(kappa_up))
                    else:
                        analysis3_summary[f"    ├─ Kappa (老師/黑板)"] = "樣本不足/無變化"
                    
                    consensus_down = temp_df['consensus'].isin(GAZE_DOWN_SURROUND)
                    ai_down = temp_df['ai'].isin(GAZE_DOWN_SURROUND)
                    if (consensus_down | ai_down).sum() > 1 and len(temp_df[consensus_down | ai_down]['ai'].unique()) > 1:
                        kappa_down = cohen_kappa_score(consensus_down, ai_down)
                        analysis3_summary[f"    └─ Kappa (書本/同學/他處)"] = (f"{kappa_down:.4f}", interpret_kappa(kappa_down))
                    else:
                        analysis3_summary[f"    └─ Kappa (書本/同學/他處)"] = "樣本不足/無變化"
                
                # 2. 【新增邏輯】對所有其他類別，遍歷其下的具體行為
                else:
                    for behavior in behaviors:
                        # 將問題轉換為二元分類 (是/不是 這個行為)
                        consensus_binary = temp_df['consensus'] == behavior
                        ai_binary = temp_df['ai'] == behavior
                        
                        # 檢查是否有足夠數據和變化來計算子類別 Kappa
                        if (consensus_binary.sum() > 0 or ai_binary.sum() > 0) and len(temp_df[consensus_binary | ai_binary]['ai'].unique()) > 1:
                            kappa_sub = cohen_kappa_score(consensus_binary, ai_binary)
                            analysis3_summary[f"    └─ Kappa ({behavior})"] = (f"{kappa_sub:.4f}", interpret_kappa(kappa_sub))
                        else:
                            analysis3_summary[f"    └─ Kappa ({behavior})"] = "樣本不足/無變化"
            
            # 如果主類別就無法計算，則直接標記
            else:
                analysis3_summary[f"  └ Kappa ({category})"] = "樣本不足/無法計算"
        
        stats_summary["【分析三：AI 與人類共識的一致性】"] = analysis3_summary

    # =========================================================================
    # --- 【v5.7 最終穩定版】分析四：群體內部一致性 (Krippendorff's Alpha) ---
    # =========================================================================
    if len(active_raters) >= 2 and ai_data:
        analysis4_summary = {}
        
        gate_status = f"(啟用 AI 信心過濾 > {ALPHA_CONFIDENCE_THRESHOLD:.0%})" if USE_CONFIDENCE_GATE_FOR_ALPHA else "(包含所有 AI 標註)"
        analysis4_summary["分析設定"] = gate_status
        
        raters_in_group = active_raters + ['AI']
        analysis4_summary["參與評分的群體"] = ", ".join(raters_in_group)
        analysis4_summary["--- 各類別 Alpha 分數 ---"] = ""

        for category, behaviors in BEHAVIOR_CATEGORIES_GROUPED.items():
            # --- 步驟 1: 計算主要類別的 Alpha (與之前相同) ---
            main_long_format_data = []
            for index, row in common_df.iterrows():
                # ... (此處數據收集邏輯與您現有的 v6.0 版本完全相同) ...
                image_path = str(row['image_path'])
                for rater in active_raters:
                    annotation = row[f'behavior_{rater}'].get(category)
                    if pd.notna(annotation):
                        main_long_format_data.append([image_path, str(rater), str(annotation)])
                
                ai_annotations = row['behavior_AI']
                ai_confidence = row['confidence_AI']
                ai_cat_annotation = next((b for b in ai_annotations if BEHAVIOR_TO_CATEGORY.get(b) == category), None)
                
                if USE_CONFIDENCE_GATE_FOR_ALPHA and ai_confidence < ALPHA_CONFIDENCE_THRESHOLD:
                    pass 
                elif pd.notna(ai_cat_annotation):
                    main_long_format_data.append([image_path, 'AI', str(ai_cat_annotation)])
            
            # 使用輔助函式計算主要類別的 Alpha
            calculate_sub_alpha(main_long_format_data, analysis4_summary, f"  └ Alpha ({category})")

            # --- 步驟 2: 【核心修改】計算子類別的 Alpha ---
            # 只有在主類別成功計算（或至少有數據）的情況下才進行子類別分析
            if analysis4_summary.get(f"  └ Alpha ({category})") not in ["樣本不足 (無任何有效標註)", "樣本不足"]:

                # 2a. 對「視線」類別進行特殊分組處理
                if category == "視線":
                    gaze_up_data, gaze_down_data = [], []
                    for index, row in common_df.iterrows():
                        image_path = str(row['image_path'])
                        # 處理人類
                        for rater in active_raters:
                            annotation = row[f'behavior_{rater}'].get(category)
                            if pd.notna(annotation):
                                gaze_up_data.append([image_path, str(rater), annotation in GAZE_UP_FORWARD])
                                gaze_down_data.append([image_path, str(rater), annotation in GAZE_DOWN_SURROUND])
                        # 處理 AI
                        ai_cat_annotation = next((b for b in row['behavior_AI'] if BEHAVIOR_TO_CATEGORY.get(b) == category), None)
                        if (not USE_CONFIDENCE_GATE_FOR_ALPHA or row['confidence_AI'] >= ALPHA_CONFIDENCE_THRESHOLD) and pd.notna(ai_cat_annotation):
                            gaze_up_data.append([image_path, 'AI', ai_cat_annotation in GAZE_UP_FORWARD])
                            gaze_down_data.append([image_path, 'AI', ai_cat_annotation in GAZE_DOWN_SURROUND])

                    calculate_sub_alpha(gaze_up_data, analysis4_summary, "    ├─ Alpha (老師/黑板)")
                    calculate_sub_alpha(gaze_down_data, analysis4_summary, "    └─ Alpha (書本/同學/他處)")

                # 2b. 對所有其他類別，遍歷其下的具體行為
                else:
                    for behavior in behaviors:
                        binary_data = []
                        for index, row in common_df.iterrows():
                            image_path = str(row['image_path'])
                            # 處理人類
                            for rater in active_raters:
                                annotation = row[f'behavior_{rater}'].get(category)
                                if pd.notna(annotation):
                                    binary_data.append([image_path, str(rater), annotation == behavior])
                            # 處理 AI
                            ai_cat_annotation = next((b for b in row['behavior_AI'] if BEHAVIOR_TO_CATEGORY.get(b) == category), None)
                            if (not USE_CONFIDENCE_GATE_FOR_ALPHA or row['confidence_AI'] >= ALPHA_CONFIDENCE_THRESHOLD) and pd.notna(ai_cat_annotation):
                                binary_data.append([image_path, 'AI', ai_cat_annotation == behavior])
                        
                        calculate_sub_alpha(binary_data, analysis4_summary, f"    └─ Alpha ({behavior})")

        stats_summary["【分析四：群體內部一致性 (Krippendorff's Alpha)】"] = analysis4_summary


    # --- 步驟 5 & 6: 打印終端機 & 生成HTML ---
    print("-" * 60)
    for group_title, group_data in stats_summary.items():
        print(f"【{group_title}】")
        if group_title == "分析二：標註員與 AI 的一致性": 
            for rater_title, rater_stats in group_data.items():
                print(f"\n   {rater_title}")
                for item_label, item_value in rater_stats.items():
                    if item_label.startswith("---"): print(f"\n   {item_label}")
                    elif isinstance(item_value, tuple): print(f"   {item_label:<45}: {item_value[0]} ({item_value[1]})")
                    elif item_value != "": print(f"   {item_label:<45}: {item_value}")
        else:
            for item_label, item_value in group_data.items():
                if item_label.startswith("---"): print(f"\n   {item_label}")
                elif isinstance(item_value, tuple): print(f"   {item_label:<45}: {item_value[0]} ({item_value[1]})")
                elif item_value != "": print(f"   {item_label:<45}: {item_value}")
    print("-" * 60)

    disagreement_records = []
    for index, row in common_df.iterrows():
        all_behaviors_sets = [set(row[f'behavior_{rater}'].values()) for rater in active_raters]
        if ai_data and 'behavior_AI' in row: all_behaviors_sets.append(set(row['behavior_AI']))
        union_set = set.union(*all_behaviors_sets) if all_behaviors_sets else set()
        intersection_set = set.intersection(*all_behaviors_sets) if all_behaviors_sets else set()
        if union_set and len(intersection_set) < len(union_set):
             disagreement_records.append(row)
             
    df_any_disagreement = pd.DataFrame(disagreement_records) if disagreement_records else pd.DataFrame(columns=common_df.columns)
    tabs_data = {"tab_summary": {"title": "統計摘要"}, "tab_any_disagree": {"title": "任何一方不一致", "data": df_any_disagreement}}
    
    generate_multi_tab_review_page(tabs_data, stats_summary, REVIEW_PAGE_FILENAME, active_raters)


# =========================================================================
# --- 4. 執行分析 ---  
# =========================================================================
if __name__ == "__main__":
    analyze_inter_rater_reliability(RATER_FILES)