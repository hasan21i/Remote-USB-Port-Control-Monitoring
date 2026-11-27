import matplotlib.pyplot as plt
import numpy as np

# 1. البيانات (Data)
systems = ['Windows GPO\n(Legacy)', 'Standard EDR\n(Antivirus)', 'Proposed Framework\n(Zero-Trust)']
times_ms = [4500, 1500, 242]  # الأرقام: GPO بطيء، EDR متوسط، نظامك سريع جداً
colors = ['#d62728', '#ff7f0e', '#2ca02c']  # أحمر (سيء)، برتقالي، أخضر (نظامك)

# 2. إعداد الرسم
plt.figure(figsize=(10, 6))
bars = plt.bar(systems, times_ms, color=colors, width=0.5)

# 3. إضافة الأرقام فوق الأعمدة
for bar in bars:
    height = bar.get_height()
    plt.text(bar.get_x() + bar.get_width()/2., height,
             f'{height} ms',
             ha='center', va='bottom', fontsize=12, fontweight='bold')

# 4. التسميات والعناوين (Academic Style)
plt.ylabel('Response Latency (Milliseconds)', fontsize=12)
plt.title('Figure 3: Time-to-Block Performance Comparison', fontsize=14, pad=20)
plt.grid(axis='y', linestyle='--', alpha=0.7)

# 5. تحسينات جمالية لإزالة الإطار العلوي والأيمن
plt.gca().spines['top'].set_visible(False)
plt.gca().spines['right'].set_visible(False)

# حفظ الصورة
plt.tight_layout()
plt.savefig('figure3_results.png', dpi=300) # دقة عالية للبحث
plt.show()