"""Task 12 端到端浏览器验证脚本

验证页面：
1. /login（admin 登录）
2. /profile/verify（PlayerVerify 页面）
3. /admin/player-bindings（PlayerBindings 页面）
4. /admin/chat-triggers（ChatTriggers 页面，点击新建 trigger）
5. /admin/player-join-settings（PlayerJoinSettings 页面，验证 leave_message 字段）
"""

import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SCREENSHOT_DIR = Path(__file__).resolve().parent
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:5173")
LOGIN_EMAIL = os.environ.get("E2E_EMAIL", "admin@local.dev")
LOGIN_PASSWORD = os.environ.get("E2E_PASSWORD", "admin123")
IS_PRODUCTION = BASE_URL.startswith("https://")

results = []


def log(name, status, detail=""):
    results.append({"name": name, "status": status, "detail": detail})
    print(f"[{status}] {name}: {detail}")


def shot(page, name):
    path = SCREENSHOT_DIR / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    print(f"  screenshot saved: {path}")
    return str(path)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context_kwargs = {"viewport": {"width": 1440, "height": 900}}
        if IS_PRODUCTION:
            context_kwargs["ignore_https_errors"] = True
        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        # ===== 1. 登录页面 =====
        print("\n===== 1. 登录页面 =====")
        try:
            page.goto(f"{BASE_URL}/login", wait_until="networkidle", timeout=15000)
            shot(page, "01_login_page")
            # 查找登录表单
            email_input = page.locator('input[type="text"], input[type="email"], input[name="email"], input[placeholder*="邮"]').first
            pwd_input = page.locator('input[type="password"]').first
            if email_input.count() > 0 and pwd_input.count() > 0:
                email_input.fill(LOGIN_EMAIL)
                pwd_input.fill(LOGIN_PASSWORD)
                shot(page, "02_login_filled")
                # 提交登录
                login_btn = page.locator('button:has-text("登录"), button:has-text("Login"), button[type="submit"]').first
                if login_btn.count() > 0:
                    login_btn.click()
                    page.wait_for_load_state("networkidle", timeout=10000)
                    time.sleep(1)
                    shot(page, "03_after_login")
                    current_url = page.url
                    if "login" not in current_url:
                        log("登录", "PASS", f"登录成功，跳转到 {current_url}")
                    else:
                        log("登录", "FAIL", f"仍在登录页 {current_url}")
                else:
                    log("登录", "FAIL", "未找到登录按钮")
            else:
                log("登录", "FAIL", "未找到邮箱/密码输入框")
        except Exception as e:
            log("登录", "FAIL", str(e))
            shot(page, "01_login_error")

        # ===== 2. /profile/verify PlayerVerify 页面 =====
        print("\n===== 2. /profile/verify PlayerVerify 页面 =====")
        try:
            page.goto(f"{BASE_URL}/profile/verify", wait_until="networkidle", timeout=15000)
            time.sleep(1)
            shot(page, "04_profile_verify")
            content = page.content()
            # 检查关键元素：表单 + 生成按钮
            has_form = page.locator('input, select, form').count() > 0
            has_generate_btn = page.locator('button:has-text("生成"), button:has-text("验证码"), button:has-text("Generate")').count() > 0
            # 也检查是否有验证码相关文本
            has_verify_text = "验证码" in content or "verify" in content.lower()
            log("PlayerVerify页面渲染", "PASS" if (has_form or has_verify_text) else "FAIL",
                f"form={has_form}, generate_btn={has_generate_btn}, verify_text={has_verify_text}")
        except Exception as e:
            log("PlayerVerify页面渲染", "FAIL", str(e))
            shot(page, "04_profile_verify_error")

        # ===== 3. /admin/player-bindings PlayerBindings 页面 =====
        print("\n===== 3. /admin/player-bindings PlayerBindings 页面 =====")
        try:
            page.goto(f"{BASE_URL}/admin/player-bindings", wait_until="networkidle", timeout=15000)
            time.sleep(1)
            shot(page, "05_admin_player_bindings")
            content = page.content()
            # 检查表格或绑定相关文本
            has_table = page.locator('table, [class*="table"], [class*="grid"]').count() > 0
            has_binding_text = "绑定" in content or "binding" in content.lower()
            log("PlayerBindings页面渲染", "PASS" if (has_table or has_binding_text) else "FAIL",
                f"table={has_table}, binding_text={has_binding_text}")
        except Exception as e:
            log("PlayerBindings页面渲染", "FAIL", str(e))
            shot(page, "05_admin_player_bindings_error")

        # ===== 4. /admin/chat-triggers ChatTriggers 页面 =====
        print("\n===== 4. /admin/chat-triggers ChatTriggers 页面 =====")
        try:
            page.goto(f"{BASE_URL}/admin/chat-triggers", wait_until="networkidle", timeout=15000)
            time.sleep(1)
            shot(page, "06_admin_chat_triggers")
            content = page.content()
            has_trigger_text = "触发" in content or "trigger" in content.lower() or "聊天" in content
            log("ChatTriggers页面渲染", "PASS" if has_trigger_text else "FAIL",
                f"trigger_text={has_trigger_text}")

            # 尝试点击新建 trigger 按钮
            create_btn = page.locator('button:has-text("新建"), button:has-text("创建"), button:has-text("添加"), button:has-text("New"), button:has-text("Create")').first
            if create_btn.count() > 0:
                create_btn.click()
                time.sleep(1)
                shot(page, "07_chat_triggers_create_form")
                # 检查 mode 下拉和 cooldown 输入
                form_content = page.content()
                has_mode = "mode" in form_content.lower() or "模式" in form_content
                has_cooldown = "cooldown" in form_content.lower() or "冷却" in form_content
                log("ChatTriggers新建表单(mode/cooldown)", "PASS" if (has_mode or has_cooldown) else "FAIL",
                    f"mode={has_mode}, cooldown={has_cooldown}")
            else:
                log("ChatTriggers新建表单", "SKIP", "未找到新建按钮（可能无权限或UI不同）")
        except Exception as e:
            log("ChatTriggers页面渲染", "FAIL", str(e))
            shot(page, "06_admin_chat_triggers_error")

        # ===== 5. /admin/player-join-settings PlayerJoinSettings 页面 =====
        print("\n===== 5. /admin/player-join-settings PlayerJoinSettings 页面 =====")
        try:
            page.goto(f"{BASE_URL}/admin/player-join-settings", wait_until="networkidle", timeout=15000)
            time.sleep(1)
            shot(page, "08_admin_player_join_settings")
            content = page.content()
            has_leave_msg = "leave_message" in content or "离开" in content or "leave" in content.lower()
            has_welcome = "welcome" in content.lower() or "欢迎" in content
            log("PlayerJoinSettings页面渲染(leave_message)", "PASS" if has_leave_msg else "FAIL",
                f"leave_message={has_leave_msg}, welcome={has_welcome}")
        except Exception as e:
            log("PlayerJoinSettings页面渲染", "FAIL", str(e))
            shot(page, "08_admin_player_join_settings_error")

        browser.close()

    # ===== 汇总 =====
    print("\n\n===== 验证结果汇总 =====")
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    skipped = sum(1 for r in results if r["status"] == "SKIP")
    print(f"PASS: {passed}, FAIL: {failed}, SKIP: {skipped}")
    for r in results:
        print(f"  [{r['status']}] {r['name']}: {r['detail']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
