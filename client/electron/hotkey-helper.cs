using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace XolasHotkeyHook
{
    class Program
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12;

        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;
        private const int VK_LCONTROL = 0xA2;
        private const int VK_RCONTROL = 0xA3;
        private const int VK_LMENU = 0xA4;
        private const int VK_RMENU = 0xA5;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int pt_x;
            public int pt_y;
        }

        private class HotkeyRule
        {
            public string Action;
            public uint TargetVk;
            public bool NeedCtrl;
            public bool NeedShift;
            public bool NeedAlt;
            public bool IsSingleModifier;
        }

        private static List<HotkeyRule> rules = new List<HotkeyRule>();
        private static HashSet<uint> keysDown = new HashSet<uint>();
        private static Dictionary<string, long> lastActionTicks = new Dictionary<string, long>();
        private static IntPtr hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc hookProc;

        private static uint ParseKeyToVk(string key)
        {
            string clean = (key ?? "").Trim().ToLowerInvariant();
            switch (clean)
            {
                case "shiftleft": return VK_LSHIFT;
                case "shiftright": return VK_RSHIFT;
                case "shift": return VK_LSHIFT;
                case "controlleft": return VK_LCONTROL;
                case "controlright": return VK_RCONTROL;
                case "ctrlleft": return VK_LCONTROL;
                case "ctrlright": return VK_RCONTROL;
                case "altleft": return VK_LMENU;
                case "altright": return VK_RMENU;
                case "capslock": return 0x14;
                case "space": return 0x20;
                case "tab": return 0x09;
                case "enter": case "return": return 0x0D;
                case "backspace": return 0x08;
                case "delete": return 0x2E;
                case "insert": return 0x2D;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
                case "f1": return 0x70;
                case "f2": return 0x71;
                case "f3": return 0x72;
                case "f4": return 0x73;
                case "f5": return 0x74;
                case "f6": return 0x75;
                case "f7": return 0x76;
                case "f8": return 0x77;
                case "f9": return 0x78;
                case "f10": return 0x79;
                case "f11": return 0x7A;
                case "f12": return 0x7B;
                default:
                    if (clean.Length == 1 && clean[0] >= 'a' && clean[0] <= 'z')
                    {
                        return (uint)(clean[0] - 'a' + 'A');
                    }
                    if (clean.Length == 1 && clean[0] >= '0' && clean[0] <= '9')
                    {
                        return (uint)clean[0];
                    }
                    return 0;
            }
        }

        private static HotkeyRule ParseAccelerator(string action, string accelerator)
        {
            if (string.IsNullOrEmpty(accelerator)) return null;

            string[] parts = accelerator.Split('+');
            bool needCtrl = false;
            bool needShift = false;
            bool needAlt = false;
            uint targetVk = 0;

            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i].Trim().ToLowerInvariant();
                if (p == "commandorcontrol" || p == "ctrl" || p == "control")
                {
                    needCtrl = true;
                }
                else if (p == "shift")
                {
                    needShift = true;
                }
                else if (p == "alt")
                {
                    needAlt = true;
                }
                else
                {
                    targetVk = ParseKeyToVk(p);
                }
            }

            // Se for tecla modificadora única (ex: ShiftLeft ou ControlLeft)
            if (parts.Length == 1)
            {
                string single = parts[0].Trim().ToLowerInvariant();
                if (single == "shiftleft" || single == "shiftright" || single == "shift" ||
                    single == "controlleft" || single == "controlright" || single == "ctrl" ||
                    single == "altleft" || single == "altright" || single == "alt")
                {
                    return new HotkeyRule
                    {
                        Action = action,
                        TargetVk = ParseKeyToVk(single),
                        NeedCtrl = false,
                        NeedShift = false,
                        NeedAlt = false,
                        IsSingleModifier = true
                    };
                }
            }

            if (targetVk == 0) return null;

            return new HotkeyRule
            {
                Action = action,
                TargetVk = targetVk,
                NeedCtrl = needCtrl,
                NeedShift = needShift,
                NeedAlt = needAlt,
                IsSingleModifier = false
            };
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);

                if (isDown || isUp)
                {
                    KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                    uint vk = kbd.vkCode;

                    if (isUp)
                    {
                        keysDown.Remove(vk);
                        if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT)
                        {
                            keysDown.Remove(VK_SHIFT);
                            keysDown.Remove(VK_LSHIFT);
                            keysDown.Remove(VK_RSHIFT);
                        }
                        else if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL)
                        {
                            keysDown.Remove(VK_CONTROL);
                            keysDown.Remove(VK_LCONTROL);
                            keysDown.Remove(VK_RCONTROL);
                        }
                        else if (vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU)
                        {
                            keysDown.Remove(VK_MENU);
                            keysDown.Remove(VK_LMENU);
                            keysDown.Remove(VK_RMENU);
                        }
                    }
                    else if (isDown && !keysDown.Contains(vk))
                    {
                        keysDown.Add(vk);

                        bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                        bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                        bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;

                        foreach (var rule in rules)
                        {
                            if (rule.IsSingleModifier)
                            {
                                bool matches = false;
                                if (rule.TargetVk == VK_LSHIFT && (vk == VK_LSHIFT || (vk == VK_SHIFT && (kbd.flags & 0x01) == 0))) matches = true;
                                else if (rule.TargetVk == VK_RSHIFT && (vk == VK_RSHIFT || (vk == VK_SHIFT && (kbd.flags & 0x01) != 0))) matches = true;
                                else if (rule.TargetVk == vk) matches = true;

                                if (matches)
                                {
                                    long now = Environment.TickCount;
                                    if (!lastActionTicks.ContainsKey(rule.Action) || (now - lastActionTicks[rule.Action] > 250))
                                    {
                                        lastActionTicks[rule.Action] = now;
                                        Console.WriteLine(rule.Action);
                                        Console.Out.Flush();
                                    }
                                    break;
                                }
                            }
                            else
                            {
                                if (rule.TargetVk == vk)
                                {
                                    bool modMatch = true;
                                    if (rule.NeedCtrl && !ctrlDown) modMatch = false;
                                    if (rule.NeedShift && !shiftDown) modMatch = false;
                                    if (rule.NeedAlt && !altDown) modMatch = false;

                                    if (modMatch)
                                    {
                                        long now = Environment.TickCount;
                                        if (!lastActionTicks.ContainsKey(rule.Action) || (now - lastActionTicks[rule.Action] > 250))
                                        {
                                            lastActionTicks[rule.Action] = now;
                                            Console.WriteLine(rule.Action);
                                            Console.Out.Flush();
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        static int Main(string[] args)
        {
            for (int i = 0; i < args.Length; i += 2)
            {
                if (i + 1 < args.Length)
                {
                    string action = args[i].TrimStart('-');
                    string accelerator = args[i + 1];
                    var rule = ParseAccelerator(action, accelerator);
                    if (rule != null)
                    {
                        rules.Add(rule);
                    }
                }
            }

            if (rules.Count == 0)
            {
                return 0;
            }

            // Watchdog: encerra se o processo pai fechar o pipe stdin
            Thread watchdog = new Thread(() =>
            {
                try
                {
                    Stream stdin = Console.OpenStandardInput();
                    while (stdin.ReadByte() != -1) { }
                }
                catch { }
                Environment.Exit(0);
            });
            watchdog.IsBackground = true;
            watchdog.Start();

            hookProc = HookCallback;
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(curModule.ModuleName), 0);
            }

            if (hookId == IntPtr.Zero)
            {
                Console.Error.WriteLine("[HotkeyHook] Falha ao instalar hook do Windows.");
                return 1;
            }

            Console.Error.WriteLine(string.Format("[HotkeyHook] Hook ativo para {0} regras.", rules.Count));

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookWindowsHookEx(hookId);
            return 0;
        }
    }
}
