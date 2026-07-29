import streamlit as st
import pandas as pd
from datetime import datetime

st.set_page_config(page_title="文件管理工具", layout="wide")

st.title("文件管理工具")

tab1, tab2, tab3 = st.tabs(["文件列表", "查重结果", "分类管理"])

with tab1:
    st.subheader("文件列表")
    
    col1, col2 = st.columns([3, 1])
    with col1:
        search = st.text_input("搜索文件名", key="search")
    with col2:
        sort_by = st.selectbox("排序", ["名称", "大小", "日期"], key="sort")
    
    # 模拟文件数据
    if "files" not in st.session_state:
        st.session_state.files = [
            {"name": "report_2026Q1.pdf", "size": 2456789, "date": "2026-01-15", "category": "documents"},
            {"name": "photo_beach.jpg", "size": 4567890, "date": "2026-02-20", "category": "images"},
            {"name": "backup_20260301.zip", "size": 123456789, "date": "2026-03-01", "category": "archives"},
            {"name": "", "size": 0, "date": "2026-03-15", "category": "others"},
        ]
    
    # 表格渲染（昨天改动的区域）
    df = pd.DataFrame(st.session_state.files)
    if not df.empty:
        styled_df = df.style.apply(
            lambda row: ['background-color: #fff3cd' if row['size'] > 100000000 else '' for _ in row],
            axis=1
        )
        st.dataframe(
            styled_df,
            column_config={
                "name": st.column_config.TextColumn("文件名", width="large"),
                "size": st.column_config.NumberColumn("大小", format="%.1f KB"),
                "date": st.column_config.TextColumn("日期", width="medium"),
                "category": st.column_config.TextColumn("分类", width="small"),
            },
            use_container_width=True,
        )

with tab2:
    st.subheader("查重结果")
    st.info("尚未执行查重扫描")

with tab3:
    st.subheader("分类管理")
    st.info("分类规则配置")
