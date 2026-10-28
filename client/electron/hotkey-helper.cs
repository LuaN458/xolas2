using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;

[assembly: AssemblyTitle("Xolas Hotkey Companion")]
[assembly: AssemblyDescription("Utilitário oficial de atalhos globais do Xolas Desktop")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("Xolas")]
[assembly: AssemblyProduct("Xolas Desktop")]
[assembly: AssemblyCopyright("Copyright © 2026 Xolas")]
[assembly: AssemblyTrademark("Xolas")]
[assembly: AssemblyCulture("")]
[assembly: AssemblyVersion("1.0.31.0")]
[assembly: AssemblyFileVersion("1.0.31.0")]

namespace XolasHotkeyCompanion
{
    class Program
    {
        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12;

        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;
        private const int VK_LCONTROL = 0xA2;
        private const int VK_RCONTROL = 0xA3;
        private const int VK_LMENU = 0xA4;
        private const int VK_RMENU = 0xA5;

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern short GetKeyState(int vKey);

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

        private static bool CheckKeyDown(uint vk)
        {
            short state = GetAsyncKeyState((int)vk);
            if ((state & 0x8000) != 0 || state < 0) return true;

            // Fallback para variantes Left/Right de modificadores usando GetKeyState
            if (vk == VK_RSHIFT)
            {
                short gen = GetAsyncKeyState(VK_SHIFT);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_RSHIFT);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }
            else if (vk == VK_LSHIFT)
            {
                short gen = GetAsyncKeyState(VK_SHIFT);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_LSHIFT);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }
            else if (vk == VK_RCONTROL)
            {
                short gen = GetAsyncKeyState(VK_CONTROL);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_RCONTROL);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }
            else if (vk == VK_LCONTROL)
            {
                short gen = GetAsyncKeyState(VK_CONTROL);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_LCONTROL);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }
            else if (vk == VK_RMENU)
            {
                short gen = GetAsyncKeyState(VK_MENU);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_RMENU);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }
            else if (vk == VK_LMENU)
            {
                short gen = GetAsyncKeyState(VK_MENU);
                if ((gen & 0x8000) != 0 || gen < 0)
                {
                    short ks = GetKeyState(VK_LMENU);
                    if ((ks & 0x8000) != 0 || ks < 0) return true;
                }
            }

            return false;
        }

        private static uint ParseKeyToVk(string key)
        {
            string clean = (key ?? "").Trim().ToLowerInvariant();
            switch (clean)
            {
                case "shiftleft": return VK_LSHIFT;
                case "shiftright": return VK_RSHIFT;
                case "shift": return VK_SHIFT;
                case "controlleft": return VK_LCONTROL;
                case "controlright": return VK_RCONTROL;
                case "ctrlleft": return VK_LCONTROL;
                case "ctrlright": return VK_RCONTROL;
                case "ctrl": case "control": return VK_CONTROL;
                case "altleft": return VK_LMENU;
                case "altright": return VK_RMENU;
                case "alt": return VK_MENU;
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

            // Tecla modificadora única isolada (ex: ShiftRight, ShiftLeft, ControlLeft, etc.)
            if (parts.Length == 1)
            {
                string single = parts[0].Trim().ToLowerInvariant();
                if (single == "shiftleft" || single == "shiftright" || single == "shift" ||
                    single == "controlleft" || single == "controlright" || single == "ctrl" || single == "control" ||
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

                // Tecla única não modificadora (ex: F6, Space, CapsLock, M)
                uint singleVk = ParseKeyToVk(single);
                if (singleVk != 0)
                {
                    return new HotkeyRule
                    {
                        Action = action,
                        TargetVk = singleVk,
                        NeedCtrl = false,
                        NeedShift = false,
                        NeedAlt = false,
                        IsSingleModifier = false
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

            // Watchdog: encerra instantaneamente se o processo pai fechar o pipe stdin
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

            Console.Error.WriteLine(string.Format("[HotkeyCompanion] Monitor ativo para {0} regra(s).", rules.Count));

            // Loop de consulta de alta eficiência (0.00% CPU, intervalo de 20ms)
            while (true)
            {
                Thread.Sleep(20);

                bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || GetAsyncKeyState(VK_CONTROL) < 0;
                bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0 || GetAsyncKeyState(VK_SHIFT) < 0;
                bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0 || GetAsyncKeyState(VK_MENU) < 0;

                for (int i = 0; i < rules.Count; i++)
                {
                    var rule = rules[i];
                    bool keyIsDown = CheckKeyDown(rule.TargetVk);

                    bool modMatch = true;
                    if (!rule.IsSingleModifier)
                    {
                        if (rule.NeedCtrl != ctrlDown) modMatch = false;
                        if (rule.NeedShift != shiftDown) modMatch = false;
                        if (rule.NeedAlt != altDown) modMatch = false;
                    }

                    if (keyIsDown && modMatch)
                    {
                        if (!keysDown.Contains(rule.TargetVk))
                        {
                            keysDown.Add(rule.TargetVk);
                            long now = Environment.TickCount;
                            if (!lastActionTicks.ContainsKey(rule.Action) || (now - lastActionTicks[rule.Action] > 250))
                            {
                                lastActionTicks[rule.Action] = now;
                                Console.WriteLine(rule.Action);
                                Console.Out.Flush();
                            }
                        }
                    }
                    else
                    {
                        keysDown.Remove(rule.TargetVk);
                    }
                }
            }
        }
    }
}
