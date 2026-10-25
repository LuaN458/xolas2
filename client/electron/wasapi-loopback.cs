using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace XolasAudioLoopback
{
    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig]
        int GetActivateResult([Out] out int activateResult, [Out, MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig]
        int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig]
        int Initialize(int ShareMode, uint StreamFlags, long hnsBufferDuration, long hnsPeriodicity, ref WAVEFORMATEX pFormat, IntPtr AudioSessionGuid);
        [PreserveSig]
        int GetBufferSize(out uint pNumBufferFrames);
        [PreserveSig]
        int GetStreamLatency(out long phnsLatency);
        [PreserveSig]
        int GetCurrentPadding(out uint pNumPaddingFrames);
        [PreserveSig]
        int IsFormatSupported(int ShareMode, ref WAVEFORMATEX pFormat, out IntPtr ppClosestMatch);
        [PreserveSig]
        int GetMixFormat(out IntPtr ppDeviceFormat);
        [PreserveSig]
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        [PreserveSig]
        int Start();
        [PreserveSig]
        int Stop();
        [PreserveSig]
        int Reset();
        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);
        [PreserveSig]
        int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [Out, MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        [PreserveSig]
        int ReleaseBuffer(uint NumFramesRead);
        [PreserveSig]
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
    {
        public uint TargetProcessId;
        public int ProcessLoopbackMode; // 0 = INCLUDE_TARGET_PROCESS_TREE, 1 = EXCLUDE_TARGET_PROCESS_TREE
    }

    [StructLayout(LayoutKind.Sequential)]
    struct AUDIOCLIENT_ACTIVATION_PARAMS
    {
        public int ActivationType; // 1 = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
        public AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BLOB
    {
        public uint cbSize;
        public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROPVARIANT
    {
        public ushort vt; // 65 = VT_BLOB
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public BLOB blob;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    class ActivateHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public ManualResetEvent DoneEvent = new ManualResetEvent(false);
        public int HResult = -1;
        public IAudioClient AudioClient = null;

        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                object unk;
                activateOperation.GetActivateResult(out HResult, out unk);
                if (HResult >= 0 && unk != null)
                {
                    AudioClient = (IAudioClient)unk;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ActivateCompleted error: " + ex.Message);
            }
            finally
            {
                DoneEvent.Set();
            }
            return 0;
        }
    }

    class Program
    {
        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
        static extern void ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            ref PROPVARIANT activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        const uint TH32CS_SNAPPROCESS = 0x00000002;
        const int AUDCLNT_SHAREMODE_SHARED = 0;
        const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        const uint AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
        const uint AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
        const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;

        static uint FindRootProcessId(uint startPid)
        {
            if (startPid == 0) return 0;
            var parentMap = new Dictionary<uint, uint>();
            var nameMap = new Dictionary<uint, string>();

            IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return startPid;

            try
            {
                PROCESSENTRY32 pe = new PROCESSENTRY32();
                pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32First(snap, ref pe))
                {
                    do
                    {
                        parentMap[pe.th32ProcessID] = pe.th32ParentProcessID;
                        nameMap[pe.th32ProcessID] = (pe.szExeFile ?? "").ToLowerInvariant();
                    } while (Process32Next(snap, ref pe));
                }
            }
            finally
            {
                CloseHandle(snap);
            }

            if (!nameMap.ContainsKey(startPid)) return startPid;
            string targetName = nameMap[startPid];
            uint current = startPid;
            var visited = new HashSet<uint>();

            while (parentMap.ContainsKey(current))
            {
                visited.Add(current);
                uint parent = parentMap[current];
                if (parent == 0 || visited.Contains(parent)) break;
                if (nameMap.ContainsKey(parent) && nameMap[parent] == targetName)
                {
                    current = parent;
                }
                else
                {
                    break;
                }
            }

            return current;
        }

        static int Main(string[] args)
        {
            uint targetPid = 0;
            uint fallbackExcludePid = 0;
            int loopbackMode = 0; // 0 = INCLUDE, 1 = EXCLUDE
            bool testOnly = false;

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--hwnd" && i + 1 < args.Length)
                {
                    long hwndVal;
                    if (long.TryParse(args[++i], out hwndVal) && hwndVal != 0)
                    {
                        uint winPid;
                        GetWindowThreadProcessId(new IntPtr(hwndVal), out winPid);
                        if (winPid != 0)
                        {
                            targetPid = FindRootProcessId(winPid);
                            loopbackMode = 0; // INCLUDE_TARGET_PROCESS_TREE
                        }
                    }
                }
                else if (args[i] == "--fallback-exclude-pid" && i + 1 < args.Length)
                {
                    uint pidVal;
                    if (uint.TryParse(args[++i], out pidVal) && pidVal != 0)
                    {
                        fallbackExcludePid = FindRootProcessId(pidVal);
                    }
                }
                else if (args[i] == "--include-pid" && i + 1 < args.Length)
                {
                    uint pidVal;
                    if (uint.TryParse(args[++i], out pidVal))
                    {
                        targetPid = FindRootProcessId(pidVal);
                        loopbackMode = 0;
                    }
                }
                else if (args[i] == "--exclude-pid" && i + 1 < args.Length)
                {
                    uint pidVal;
                    if (uint.TryParse(args[++i], out pidVal))
                    {
                        targetPid = FindRootProcessId(pidVal);
                        loopbackMode = 1; // EXCLUDE_TARGET_PROCESS_TREE
                    }
                }
                else if (args[i] == "--test")
                {
                    testOnly = true;
                }
            }

            // Se o HWND for invalido ou apontar para o proprio Xolas, usar EXCLUDE_TREE no Xolas para nunca vazar a call
            if (fallbackExcludePid != 0 && (targetPid == 0 || (loopbackMode == 0 && targetPid == fallbackExcludePid)))
            {
                targetPid = fallbackExcludePid;
                loopbackMode = 1; // EXCLUDE_TARGET_PROCESS_TREE
            }

            if (targetPid == 0)
            {
                Console.Error.WriteLine("Invalid target PID.");
                return 1;
            }

            Console.Error.WriteLine(string.Format("[WASAPI] TargetPID={0} Mode={1}", targetPid, loopbackMode == 0 ? "INCLUDE_TREE" : "EXCLUDE_TREE"));

            AUDIOCLIENT_ACTIVATION_PARAMS actParams = new AUDIOCLIENT_ACTIVATION_PARAMS();
            actParams.ActivationType = 1; // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            actParams.ProcessLoopbackParams.TargetProcessId = targetPid;
            actParams.ProcessLoopbackParams.ProcessLoopbackMode = loopbackMode;

            int paramsSize = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS));
            IntPtr paramsPtr = Marshal.AllocCoTaskMem(paramsSize);
            Marshal.StructureToPtr(actParams, paramsPtr, false);

            PROPVARIANT propVar = new PROPVARIANT();
            propVar.vt = 65; // VT_BLOB
            propVar.blob.cbSize = (uint)paramsSize;
            propVar.blob.pBlobData = paramsPtr;

            try
            {
                ActivateHandler handler = new ActivateHandler();
                IActivateAudioInterfaceAsyncOperation asyncOp;
                Guid iidAudioClient = typeof(IAudioClient).GUID;

                ActivateAudioInterfaceAsync(
                    "VAD\\Process_Loopback",
                    iidAudioClient,
                    ref propVar,
                    handler,
                    out asyncOp);

                if (!handler.DoneEvent.WaitOne(5000) || handler.AudioClient == null)
                {
                    Console.Error.WriteLine(string.Format("[WASAPI] Activation failed or timed out. HRESULT=0x{0:X8}", handler.HResult));
                    return 2;
                }

                IAudioClient audioClient = handler.AudioClient;

                // Formato padrao 48000 Hz, 2 canais (Estereo), 16-bit PCM
                WAVEFORMATEX fmt = new WAVEFORMATEX();
                fmt.wFormatTag = 1; // WAVE_FORMAT_PCM
                fmt.nChannels = 2;
                fmt.nSamplesPerSec = 48000;
                fmt.wBitsPerSample = 16;
                fmt.nBlockAlign = (ushort)(fmt.nChannels * (fmt.wBitsPerSample / 8));
                fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
                fmt.cbSize = 0;

                EventWaitHandle sampleEvent = new EventWaitHandle(false, EventResetMode.AutoReset);

                uint flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                             AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                             AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                             AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

                int hr = audioClient.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    flags,
                    200000, // 20ms buffer
                    0,
                    ref fmt,
                    IntPtr.Zero);

                if (hr < 0)
                {
                    Console.Error.WriteLine(string.Format("[WASAPI] IAudioClient::Initialize failed: 0x{0:X8}", hr));
                    return 3;
                }

                audioClient.SetEventHandle(sampleEvent.SafeWaitHandle.DangerousGetHandle());

                object capObj;
                hr = audioClient.GetService(typeof(IAudioCaptureClient).GUID, out capObj);
                if (hr < 0 || capObj == null)
                {
                    Console.Error.WriteLine(string.Format("[WASAPI] GetService(IAudioCaptureClient) failed: 0x{0:X8}", hr));
                    return 4;
                }

                IAudioCaptureClient captureClient = (IAudioCaptureClient)capObj;
                hr = audioClient.Start();
                if (hr < 0)
                {
                    Console.Error.WriteLine(string.Format("[WASAPI] IAudioClient::Start failed: 0x{0:X8}", hr));
                    return 5;
                }

                Console.Error.WriteLine("[WASAPI] Capture started successfully (48kHz, Stereo, 16-bit PCM).");
                if (testOnly)
                {
                    audioClient.Stop();
                    return 0;
                }

                // Watchdog thread: encerra automaticamente se o processo pai (Electron) fechar o pipe stdin
                Thread stdinWatchdog = new Thread(() =>
                {
                    try
                    {
                        Stream stdin = Console.OpenStandardInput();
                        while (stdin.ReadByte() != -1) { }
                    }
                    catch { }
                    Environment.Exit(0);
                });
                stdinWatchdog.IsBackground = true;
                stdinWatchdog.Start();

                Stream stdout = Console.OpenStandardOutput();
                byte[] tempBuf = new byte[48000 * 4];
                byte[] silenceBuf = new byte[480 * 4]; // 10ms of silence

                while (true)
                {
                    sampleEvent.WaitOne(20);

                    uint nextPacketSize = 0;
                    int pHr = captureClient.GetNextPacketSize(out nextPacketSize);
                    if (pHr < 0) break;

                    while (nextPacketSize > 0)
                    {
                        IntPtr dataPtr;
                        uint numFrames;
                        uint bufFlags;
                        ulong devPos;
                        ulong qpcPos;

                        int bHr = captureClient.GetBuffer(out dataPtr, out numFrames, out bufFlags, out devPos, out qpcPos);
                        if (bHr < 0) break;

                        int bytesToWrite = (int)(numFrames * fmt.nBlockAlign);
                        if (bytesToWrite > 0)
                        {
                            if ((bufFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                            {
                                if (silenceBuf.Length < bytesToWrite)
                                {
                                    silenceBuf = new byte[bytesToWrite];
                                }
                                stdout.Write(silenceBuf, 0, bytesToWrite);
                            }
                            else
                            {
                                if (tempBuf.Length < bytesToWrite)
                                {
                                    tempBuf = new byte[bytesToWrite];
                                }
                                Marshal.Copy(dataPtr, tempBuf, 0, bytesToWrite);
                                stdout.Write(tempBuf, 0, bytesToWrite);
                            }
                            stdout.Flush();
                        }

                        captureClient.ReleaseBuffer(numFrames);
                        pHr = captureClient.GetNextPacketSize(out nextPacketSize);
                        if (pHr < 0) break;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[WASAPI] Fatal error: " + ex.Message);
                return 9;
            }
            finally
            {
                Marshal.FreeCoTaskMem(paramsPtr);
            }

            return 0;
        }
    }
}
