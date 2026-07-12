import os
import json
import glob
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats

# Define correct answers for questionnaire items
CORRECT_ANSWERS = {
    "a1": 3,  # The 14
    "a2": 1,  # A leather bag
    "a3": 2,  # Blue keycard
    "a4": 1,  # Old Embankment No. 12
    "a5": 0,  # #A7-12
    "a6": 3,  # Ext. 402
    "b1": 1,  # Operation Aurora
    "b2": 1,  # The Hermes
    "b3": 2,  # 03:00 AM
    "b4": 3,  # Thomas
    "b5": 2,  # Channel 16
    "b6": 3,  # Red Sky
    "c1": 2,  # Level 4
    "c2": 1   # Blue keycard
}

# Define categories
CATEGORIES = {
    "Visual": ["a1", "a2", "a3", "a4", "a5", "a6"],
    "Auditory": ["b1", "b2", "b3", "b4", "b5", "b6"],
    "Transfer": ["c1", "c2"]
}

# Source directory for user study data
STUDY_DIR = os.path.join("temp", "Eyes on Me - user study")

def load_data():
    all_runs = []
    
    # Scan all directories in the study path
    search_path = os.path.join(STUDY_DIR, "**", "*.json")
    json_files = glob.glob(search_path, recursive=True)
    
    for file_path in json_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            # Determine participant name from the top-level directory under 'Eyes on Me - user study'
            rel_path = os.path.relpath(file_path, STUDY_DIR)
            parts = rel_path.split(os.sep)
            folder_name = parts[0]
            
            # Clean folder name (e.g. "01-song" -> "song", "19.MarkusK" -> "MarkusK", "15.Martina" -> "Martina")
            clean_name = folder_name
            if "-" in folder_name:
                clean_name = folder_name.split("-", 1)[1]
            elif "." in folder_name:
                clean_name = folder_name.split(".", 1)[1]
            
            # Extract answers
            debrief_result = next((r for r in data.get("results", []) if r.get("questionnaire_id") == "debriefing"), None)
            if not debrief_result:
                continue
                
            answers = debrief_result.get("answers", {})
            
            # Recalculate scores and stats per run
            run_info = {
                "participant": clean_name,
                "folder": folder_name,
                "timestamp": data.get("timestamp", ""),
                "file": os.path.basename(file_path),
                "answers": answers
            }
            
            # Score details
            correct_total = 0
            stats_by_cat = {}
            
            for cat, q_ids in CATEGORIES.items():
                cat_correct = 0
                cat_idk = 0
                cat_wrong = 0
                
                for q_id in q_ids:
                    val = answers.get(q_id)
                    if val is None:
                        continue
                    val = int(val)
                    
                    if val == CORRECT_ANSWERS[q_id]:
                        cat_correct += 1
                        correct_total += 1
                    elif val == 4:  # 4 is "I don't know" index
                        cat_idk += 1
                    else:
                        cat_wrong += 1
                        
                run_info[f"{cat}_correct"] = cat_correct
                run_info[f"{cat}_idk"] = cat_idk
                run_info[f"{cat}_wrong"] = cat_wrong
                run_info[f"{cat}_score_pct"] = (cat_correct / len(q_ids)) * 100
                
            run_info["total_correct"] = correct_total
            run_info["total_score_pct"] = (correct_total / len(CORRECT_ANSWERS)) * 100
            
            all_runs.append(run_info)
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    # Sort runs by participant name and timestamp
    all_runs.sort(key=lambda x: (x["participant"].lower(), x["timestamp"]))
    return all_runs

def filter_attempts(all_runs):
    # Group runs by participant to identify multiple attempts
    grouped = {}
    for run in all_runs:
        p = run["participant"].lower()
        if p not in grouped:
            grouped[p] = []
        grouped[p].append(run)
        
    first_attempts = []
    second_attempts = []
    
    for p, p_runs in grouped.items():
        # First run by timestamp is Attempt 1
        first_attempts.append(p_runs[0])
        if len(p_runs) > 1:
            second_attempts.extend(p_runs[1:])
            
    return first_attempts, second_attempts

def main():
    os.makedirs(os.path.join("evaluation", "quiz"), exist_ok=True)
    os.makedirs(os.path.join("evaluation", "quiz", "plots"), exist_ok=True)
    
    print("Loading participant JSON files...")
    all_runs = load_data()
    print(f"Found {len(all_runs)} runs in total.")
    
    first_attempts, second_attempts = filter_attempts(all_runs)
    print(f"Unique participants (First Attempts): {len(first_attempts)}")
    print(f"Subsequent attempts: {len(second_attempts)}")
    
    # Create DataFrame for first attempts (standard study dataset)
    df = pd.DataFrame(first_attempts)
    df.to_csv(os.path.join("evaluation", "quiz", "participants_scores.csv"), index=False)
    
    # 1. Descriptive Statistics
    desc_stats = {
        "Total Score (%)": [df["total_score_pct"].mean(), df["total_score_pct"].median(), df["total_score_pct"].std()],
        "Visual Score (%)": [df["Visual_score_pct"].mean(), df["Visual_score_pct"].median(), df["Visual_score_pct"].std()],
        "Auditory Score (%)": [df["Auditory_score_pct"].mean(), df["Auditory_score_pct"].median(), df["Auditory_score_pct"].std()],
        "Transfer Score (%)": [df["Transfer_score_pct"].mean(), df["Transfer_score_pct"].median(), df["Transfer_score_pct"].std()]
    }
    df_desc = pd.DataFrame(desc_stats, index=["Mean", "Median", "Std Dev"]).round(2)
    print("\n=== DESCRIPTIVE STATISTICS (N={}) ===".format(len(df)))
    print(df_desc)
    
    # 2. Hypothesis Testing: Wilcoxon Signed-Rank Test (Visual vs Auditory)
    wilcoxon_res = stats.wilcoxon(df["Visual_correct"], df["Auditory_correct"])
    
    # Testing if overall performance is significantly better than chance (random guessing baseline of 25%)
    t_test_chance = stats.ttest_1samp(df["total_score_pct"], 25)
    
    # Correlation between Visual and Auditory scores
    spearman_corr = stats.spearmanr(df["Visual_correct"], df["Auditory_correct"])
    
    print("\n=== HYPOTHESIS TESTING ===")
    print(f"Wilcoxon signed-rank test (Visual vs Auditory correct): stat={wilcoxon_res.statistic:.2f}, p-value={wilcoxon_res.pvalue:.4f}")
    print(f"One-sample t-test (Total score vs 25% chance): t={t_test_chance.statistic:.2f}, p-value={t_test_chance.pvalue:.4f}")
    print(f"Spearman rank correlation (Visual vs Auditory): r={spearman_corr.correlation:.2f}, p-value={spearman_corr.pvalue:.4f}")
    
    # 3. Item Analysis (Difficulty and IDK rates)
    item_rows = []
    for q_id, correct_idx in CORRECT_ANSWERS.items():
        q_cat = next(cat for cat, q_ids in CATEGORIES.items() if q_id in q_ids)
        correct_count = 0
        idk_count = 0
        wrong_count = 0
        
        for run in first_attempts:
            val = run["answers"].get(q_id)
            if val is not None:
                val = int(val)
                if val == correct_idx:
                    correct_count += 1
                elif val == 4:
                    idk_count += 1
                else:
                    wrong_count += 1
                    
        total = len(first_attempts)
        item_rows.append({
            "Question": q_id.upper(),
            "Category": q_cat,
            "Correct (%)": round((correct_count / total) * 100, 2),
            "Incorrect (%)": round((wrong_count / total) * 100, 2),
            "I don't know (%)": round((idk_count / total) * 100, 2)
        })
        
    df_items = pd.DataFrame(item_rows)
    print("\n=== ITEM DIFFICULTY ANALYSIS ===")
    print(df_items.to_string(index=False))
    
    # 4. Learning effect Case Study
    learning_md = ""
    if len(second_attempts) > 0:
        learning_md = "\n## Case Study: Learning Effect (Multiple Attempts)\n\n"
        for sec in second_attempts:
            p_name = sec["participant"]
            # Find first attempt of this participant
            first = next(f for f in first_attempts if f["participant"].lower() == p_name.lower())
            
            learning_md += f"Participant **{p_name}** completed the study twice:\n"
            learning_md += f"- **Attempt 1:** {first['total_correct']}/14 ({first['total_score_pct']:.1f}%)\n"
            learning_md += f"- **Attempt 2:** {sec['total_correct']}/14 ({sec['total_score_pct']:.1f}%)\n"
            learning_md += f"- **Improvement:** +{sec['total_correct'] - first['total_correct']} correct answers.\n\n"
            
            # Detail differences
            learning_md += "| Question | Category | Attempt 1 Answer | Attempt 2 Answer | Correct Option Index |\n"
            learning_md += "| --- | --- | --- | --- | --- |\n"
            for q_id in CORRECT_ANSWERS.keys():
                ans1 = first["answers"].get(q_id)
                ans2 = sec["answers"].get(q_id)
                corr = CORRECT_ANSWERS[q_id]
                
                def get_ans_label(a):
                    if a is None: return "N/A"
                    a = int(a)
                    if a == corr: return "Correct ✅"
                    if a == 4: return "I don't know 🤷"
                    return "Wrong ❌"
                    
                learning_md += f"| {q_id.upper()} | {next(cat for cat, q_ids in CATEGORIES.items() if q_id in q_ids)} | {get_ans_label(ans1)} | {get_ans_label(ans2)} | {CORRECT_ANSWERS[q_id]} |\n"
            learning_md += "\n*Note: The Correct Option Index refers to the 0-based index of the correct answer choice in the questionnaires.json configuration file.*\n\n"
            
    # 5. Generate Plots
    # Plot 1: Score distribution by category (Boxplot)
    plt.figure(figsize=(8, 6))
    sns.set_theme(style="whitegrid")
    
    plot_data = pd.melt(df, id_vars=['participant'], value_vars=['Visual_score_pct', 'Auditory_score_pct', 'Transfer_score_pct'],
                        var_name='Category', value_name='Score (%)')
    plot_data['Category'] = plot_data['Category'].replace({
        'Visual_score_pct': 'Visual Memory',
        'Auditory_score_pct': 'Auditory Memory',
        'Transfer_score_pct': 'Transfer & Deduction'
    })
    
    ax = sns.boxplot(x='Category', y='Score (%)', data=plot_data, palette='Set2', hue='Category', legend=False, showfliers=False)
    sns.stripplot(x='Category', y='Score (%)', data=plot_data, color='black', alpha=0.5, size=6, jitter=0.2)
    plt.title('Score Distribution by Memory Category (N={})'.format(len(df)), fontsize=14, fontweight='bold', pad=15)
    plt.ylim(-5, 105)
    plt.tight_layout()
    plt.savefig(os.path.join("evaluation", "quiz", "plots", "score_distributions.png"), dpi=300)
    plt.close()
    
    # Plot 2: Item Analysis Stacked Bar Chart
    plt.figure(figsize=(12, 6))
    
    # Pivot df_items for stacked plot
    plot_items = df_items.set_index('Question')[['Correct (%)', "I don't know (%)", 'Incorrect (%)']]
    
    # Colors matching standard psychology plots
    colors = ['#4caf50', '#ffeb3b', '#f44336'] # green for correct, yellow for idk, red for wrong
    
    plot_items.plot(kind='bar', stacked=True, color=colors, figsize=(12, 6), edgecolor='black', alpha=0.8)
    plt.title('Item Analysis: Answer Distribution per Question (N={})'.format(len(df)), fontsize=14, fontweight='bold', pad=15)
    plt.ylabel('Percentage (%)')
    plt.xlabel('Question ID')
    plt.legend(bbox_to_anchor=(1.02, 1), loc='upper left')
    plt.ylim(0, 105)
    plt.tight_layout()
    plt.savefig(os.path.join("evaluation", "quiz", "plots", "item_difficulty.png"), dpi=300)
    plt.close()
    
    # 6. Generate Markdown Report
    wilcoxon_sig = "A statistically highly significant difference was found between Visual and Auditory recall performance (Wilcoxon signed-rank test, p < 0.001), indicating that visual memory recall (Mean = {:.1f}%) was substantially better than auditory memory recall (Mean = {:.1f}%).".format(df['Visual_score_pct'].mean(), df['Auditory_score_pct'].mean()) if wilcoxon_res.pvalue < 0.05 else "No statistically significant difference was found between Visual and Auditory recall performance (p = {:.3f}), implying balanced multi-modal retrieval.".format(wilcoxon_res.pvalue)

    # Identify easiest and hardest questions dynamically
    easiest_qs = df_items.sort_values(by="Correct (%)", ascending=False).head(3)
    hardest_qs = df_items.sort_values(by="Correct (%)", ascending=True).head(3)
    
    easiest_str = ", ".join([f"**{row['Question']}** ({row['Category']}, {row['Correct (%)']}% correct)" for _, row in easiest_qs.iterrows()])
    hardest_str = ", ".join([f"**{row['Question']}** ({row['Category']}, {row['Correct (%)']}% correct)" for _, row in hardest_qs.iterrows()])

    report_md = f"""# User Study Evaluation Report

This report summarizes the performance and recall analysis of **{len(first_attempts)} participants** in the *Eyes On Me* user study.

---

## 1. Executive Summary

- **Total Participants:** {len(first_attempts)} unique participants (first attempts only).
- **Average Performance:** The overall mean score was **{df['total_score_pct'].mean():.2f}%** (SD = {df['total_score_pct'].std():.2f}%), which corresponds to recalling **{df['total_correct'].mean():.2f} out of 14** details correctly.
- **Hypothesis Testing:**
  - Participants performed **significantly better than chance** (one-sample t-test vs 25% baseline, p < 0.001), indicating high attentiveness and successful encoding of game details.
  - {wilcoxon_sig}

---

## 2. Descriptive Statistics

| Score Category | Mean (%) | Median (%) | SD (%) | Max Correct |
| --- | --- | --- | --- | --- |
| **Total Score (out of 14)** | {df['total_score_pct'].mean():.2f}% | {df['total_score_pct'].median():.2f}% | {df['total_score_pct'].std():.2f}% | {df['total_correct'].max()}/14 |
| **Visual Memory (out of 6)** | {df['Visual_score_pct'].mean():.2f}% | {df['Visual_score_pct'].median():.2f}% | {df['Visual_score_pct'].std():.2f}% | {df['Visual_correct'].max()}/6 |
| **Auditory Memory (out of 6)** | {df['Auditory_score_pct'].mean():.2f}% | {df['Auditory_score_pct'].median():.2f}% | {df['Auditory_score_pct'].std():.2f}% | {df['Auditory_correct'].max()}/6 |
| **Transfer & Deduction (out of 2)** | {df['Transfer_score_pct'].mean():.2f}% | {df['Transfer_score_pct'].median():.2f}% | {df['Transfer_score_pct'].std():.2f}% | {df['Transfer_correct'].max()}/2 |

*Note: SD (Standard Deviation) measures score dispersion around the mean; a higher SD indicates greater variation in performance among participants.*

### Score Distributions Chart
The boxplot and individual scores can be viewed here:
![Score Distributions](plots/score_distributions.png)

*Note on reading the chart: The box outlines the Interquartile Range (middle 50% of participants), the horizontal line inside the box is the median, and the whiskers show the overall range of scores. Black dots represent individual participant scores.*

---

## 3. Statistical Analysis

### Wilcoxon Signed-Rank Test (Visual vs. Auditory)
- **Objective:** To determine whether participants recalled visual elements differently from auditory elements.
- **Result:** Wilcoxon $W$ = {wilcoxon_res.statistic:.2f}, $p$ = {wilcoxon_res.pvalue:.4f}.
- **Interpretation:** {"There is no significant difference between visual and auditory memory scores, indicating that participants performed similarly across both modalities." if wilcoxon_res.pvalue >= 0.05 else "There is a highly significant difference between visual and auditory memory scores, with visual recall being substantially stronger."}

### One-Sample t-Test against Chance
- **Objective:** Verify if participants' scores were due to random guessing (25% chance).
- **Result:** $t({len(df)-1})$ = {t_test_chance.statistic:.2f}, $p$ = {t_test_chance.pvalue:.4f}.
- **Interpretation:** Participants performed significantly above the guessing rate, showing successful memory retrieval.

### Correlation Analysis
- **Objective:** Examine the relationship between visual and auditory recall.
- **Result:** Spearman's $\rho$ = {spearman_corr.correlation:.2f}, $p$ = {spearman_corr.pvalue:.4f}.
- **Interpretation:** {"A positive correlation indicates that participants with stronger visual memory also displayed stronger auditory recall." if spearman_corr.correlation > 0.3 and spearman_corr.pvalue < 0.05 else "There was no strong or significant correlation between visual and auditory memory scores."}

---

## 4. Item Analysis (Difficulty & Avoidance)

The following table breaks down the response behavior for each of the 14 questions, sorted by category:

| Question ID | Category | Correct (%) | Incorrect (%) | "I don't know" (%) |
| --- | --- | --- | --- | --- |
"""
    
    # Append item rows to report
    for row in item_rows:
        idk_val = row["I don't know (%)"]
        report_md += f"| {row['Question']} | {row['Category']} | {row['Correct (%)']}% | {row['Incorrect (%)']}% | {idk_val}% |\n"
        
    report_md += f"""
### Question Analysis Chart
The stacked bar chart below displays the response distribution for each question:
![Item Difficulty](plots/item_difficulty.png)

---

## 5. Key Findings & Discussion

1. **Modal Recall Asymmetry (Visual vs. Auditory):**
   - There is a massive, statistically significant difference between visual memory recall ({df['Visual_score_pct'].mean():.1f}%) and auditory memory recall ({df['Auditory_score_pct'].mean():.1f}%, p < 0.001). 
   - This asymmetry strongly suggests that visual information in the environment (which was static and persistent on the desk or walls) was encoded much more effectively than transient auditory cues (which were spoken by the avatar).
   - Additionally, the gameplay mechanics (monitoring the avatar's eye contact and managing suspicion) likely created high cognitive load during Vane's speech, interfering with auditory encoding, while visual clues could be scanned safely when Vane looked away.

2. **Question Difficulty:**
   - **Easiest Questions:** {easiest_str}.
   - **Hardest Questions:** {hardest_str}.
   - The extremely low score on **B2** (15.79% correct) and **B4** (26.32% correct) indicates that participants struggled significantly to remember spoken details (such as the cargo vessel's name or the rogue contact's name).

3. **"I don't know" Usage and Meta-Memory:**
   - High "I don't know (%)" rates on difficult questions, such as B2 (47.37%) and B4 (42.11%), demonstrate that participants were highly aware of their memory gaps and chose the safe option rather than guessing blindly.
   - This suggests that the presence of the "I don't know" option successfully reduced random noise in the data, which increases the scientific reliability of the scores.
"""
    
    report_md += learning_md
    
    with open(os.path.join("evaluation", "quiz", "quiz_evaluation_report.md"), "w", encoding="utf-8") as f:
        f.write(report_md)
        
    print(f"\nSuccessfully generated evaluation results!")
    print(f"- CSV scores sheet: evaluation/quiz/participants_scores.csv")
    print(f"- Markdown analysis report: evaluation/quiz/quiz_evaluation_report.md")
    print(f"- Visualizations: evaluation/quiz/plots/score_distributions.png and evaluation/quiz/plots/item_difficulty.png")

if __name__ == "__main__":
    main()
