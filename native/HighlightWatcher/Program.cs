using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using Interop.UIAutomationClient;

namespace HighlightWatcher;

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);
    
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    private static bool _running = true;

    private static void Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.Error.WriteLine("[INIT] HighlightWatcher starting...");
        
        using var watcher = new SelectionWatcher();
        using var keyboardWatcher = new KeyboardWatcher();

        try
        {
            watcher.Start();
            keyboardWatcher.Start();
            Console.Error.WriteLine("[INIT] Watcher started. Monitoring for text selection and keyboard...");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ERROR] Failed to start: {ex.Message}");
            return;
        }

        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            _running = false;
        };

        // Message loop - required for low-level keyboard hooks to work
        Console.Error.WriteLine("[INIT] Starting message loop...");
        while (_running && GetMessage(out MSG msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        
        Console.Error.WriteLine("[INIT] Shutting down...");
    }
}

// Keyboard Watcher untuk mendeteksi Ctrl+C
internal sealed class KeyboardWatcher : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int VK_C = 0x43;
    private const int VK_CONTROL = 0x11;
    
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private LowLevelKeyboardProc? _proc;
    private IntPtr _hookId = IntPtr.Zero;
    private DateTimeOffset _lastCtrlCTimestamp = DateTimeOffset.MinValue;
    private const int CtrlCDebounceMs = 300; // Debounce untuk mencegah double trigger

    public void Start()
    {
        _proc = HookCallback;
        _hookId = SetHook(_proc);
        
        if (_hookId == IntPtr.Zero)
        {
            Console.Error.WriteLine("[KEYBOARD] Warning: Failed to set keyboard hook");
        }
        else
        {
            Console.Error.WriteLine("[KEYBOARD] Keyboard hook installed successfully");
        }
    }

    public void Dispose()
    {
        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
        GC.SuppressFinalize(this);
    }

    private IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
        using var curModule = curProcess.MainModule!;
        return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && wParam == (IntPtr)WM_KEYDOWN)
        {
            int vkCode = Marshal.ReadInt32(lParam);
            
            // Detect Ctrl+C
            if (vkCode == VK_C && (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0)
            {
                var now = DateTimeOffset.UtcNow;
                
                // Debounce check
                if (now - _lastCtrlCTimestamp > TimeSpan.FromMilliseconds(CtrlCDebounceMs))
                {
                    _lastCtrlCTimestamp = now;
                    EmitCtrlCEvent();
                }
            }
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    private void EmitCtrlCEvent()
    {
        var payload = new CtrlCPayload
        {
            Type = "ctrl-c",
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        var json = JsonSerializer.Serialize(payload, _jsonOptions);
        Console.WriteLine(json);
        Console.Out.Flush();
        
        Console.Error.WriteLine("[KEYBOARD] ✓ Ctrl+C detected");
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
}

internal sealed class CtrlCPayload
{
    public string? Type { get; set; }
    public long Timestamp { get; set; }
}

internal sealed class SelectionWatcher : IDisposable
{
    // Events for selection detection
    private const uint EventObjectTextSelectionChanged = 0x8014;
    private const uint EventObjectSelection = 0x8006;
    private const uint EventObjectSelectionAdd = 0x8007;
    private const uint EventSystemCaptureEnd = 0x0009;  // Mouse capture released
    
    private const int ObjIdClient = 0;
    private const uint WineventOutofcontext = 0x0000;
    private const uint WineventSkipownprocess = 0x0002;
    private const int MinTextLength = 3;
    private const int SelectionStableDelayMs = 500; // Wait this long for selection to stabilize
    private const int PollingIntervalMs = 400; // Slower polling

    private readonly IUIAutomation _automation = new CUIAutomation();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly object _syncRoot = new();
    private readonly System.Timers.Timer _pollingTimer;
    private System.Timers.Timer? _selectionStabilizeTimer;

    private WinEventDelegate? _eventDelegate;
    private readonly List<IntPtr> _eventHooks = new();
    
    private string? _lastTextSignature;
    private DateTimeOffset _lastEmitTimestamp = DateTimeOffset.MinValue;
    private DateTimeOffset _lastSelectionChangeTimestamp = DateTimeOffset.MinValue;
    private int _eventCount = 0;

    public SelectionWatcher()
    {
        _pollingTimer = new System.Timers.Timer(PollingIntervalMs);
        _pollingTimer.Elapsed += (s, e) => CheckSelectionPolling();
    }

    public void Start()
    {
        if (_eventHooks.Count > 0)
        {
            return;
        }

        _eventDelegate = OnWinEvent;

        // Register only essential events
        var eventsToRegister = new[]
        {
            EventObjectTextSelectionChanged,
            EventObjectSelection,
            EventObjectSelectionAdd,
            EventSystemCaptureEnd  // This fires when mouse is released
        };

        foreach (var eventType in eventsToRegister)
        {
            var hook = SetWinEventHook(
                eventType,
                eventType,
                IntPtr.Zero,
                _eventDelegate,
                0,
                0,
                WineventOutofcontext | WineventSkipownprocess);

            if (hook != IntPtr.Zero)
            {
                _eventHooks.Add(hook);
                Console.Error.WriteLine($"[HOOK] Registered event 0x{eventType:X4}");
            }
        }

        if (_eventHooks.Count == 0)
        {
            throw new InvalidOperationException("Failed to register any event hooks");
        }

        _pollingTimer.Start();
        Console.Error.WriteLine("[POLL] Polling timer started");
    }

    public void Dispose()
    {
        lock (_syncRoot)
        {
            _pollingTimer?.Stop();
            _pollingTimer?.Dispose();
            _selectionStabilizeTimer?.Stop();
            _selectionStabilizeTimer?.Dispose();

            foreach (var hook in _eventHooks)
            {
                UnhookWinEvent(hook);
            }
            _eventHooks.Clear();
        }
        GC.SuppressFinalize(this);
    }

    private void OnWinEvent(IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime)
    {
        _eventCount++;

        // When selection changes, reset the stabilize timer
        if (eventType == EventObjectTextSelectionChanged || 
            eventType == EventObjectSelection || 
            eventType == EventObjectSelectionAdd)
        {
            _lastSelectionChangeTimestamp = DateTimeOffset.UtcNow;
            
            // Cancel existing timer
            if (_selectionStabilizeTimer != null)
            {
                _selectionStabilizeTimer.Stop();
                _selectionStabilizeTimer.Dispose();
                _selectionStabilizeTimer = null;
            }

            // Start new timer - will only fire if no more selection events come
            _selectionStabilizeTimer = new System.Timers.Timer(SelectionStableDelayMs);
            _selectionStabilizeTimer.AutoReset = false;
            _selectionStabilizeTimer.Elapsed += (s, e) =>
            {
                // Selection has been stable for SelectionStableDelayMs
                Console.Error.WriteLine("[STABLE] Selection stabilized, capturing...");
                EmitSelectionPayload();
            };
            _selectionStabilizeTimer.Start();
            
            // Log occasionally
            if (_eventCount % 10 == 1)
            {
                Console.Error.WriteLine($"[EVENT] Selection changing... (#{_eventCount})");
            }
            return;
        }

        // Capture end event - user released mouse/stopped selecting
        if (eventType == EventSystemCaptureEnd)
        {
            Console.Error.WriteLine("[EVENT] Mouse released - capturing selection immediately");
            
            // Cancel stabilize timer since we know selection is done
            if (_selectionStabilizeTimer != null)
            {
                _selectionStabilizeTimer.Stop();
                _selectionStabilizeTimer.Dispose();
                _selectionStabilizeTimer = null;
            }
            
            // Emit immediately when mouse is released - this is the perfect timing!
            EmitSelectionPayload();
            return;
        }
    }

    private void CheckSelectionPolling()
    {
        // Only poll if there's been no recent selection activity
        var timeSinceLastChange = DateTimeOffset.UtcNow - _lastSelectionChangeTimestamp;
        if (timeSinceLastChange < TimeSpan.FromMilliseconds(SelectionStableDelayMs))
        {
            return; // Selection is still changing, don't poll
        }

        try
        {
            EmitSelectionPayload();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ERROR] Polling: {ex.Message}");
        }
    }

    private void EmitSelectionPayload()
    {
        // Don't emit too frequently
        var now = DateTimeOffset.UtcNow;
        if (now - _lastEmitTimestamp < TimeSpan.FromMilliseconds(100))
        {
            return;
        }

        IUIAutomationElement? focusedElement = null;
        try
        {
            focusedElement = _automation.GetFocusedElement();
        }
        catch (Exception)
        {
            return;
        }

        if (focusedElement == null)
        {
            return;
        }

        try
        {
            object? patternObj = null;
            
            try
            {
                patternObj = focusedElement.GetCurrentPattern(UIA_PatternIds.UIA_TextPattern2Id);
            }
            catch { }

            if (patternObj == null)
            {
                try
                {
                    patternObj = focusedElement.GetCurrentPattern(UIA_PatternIds.UIA_TextPatternId);
                }
                catch { }
            }

            if (patternObj is not IUIAutomationTextPattern textPattern)
            {
                if (patternObj != null)
                {
                    Marshal.ReleaseComObject(patternObj);
                }
                return;
            }

            IUIAutomationTextRangeArray? selectionArray = null;
            try
            {
                selectionArray = textPattern.GetSelection();
            }
            catch
            {
                selectionArray = null;
            }

            if (selectionArray == null || selectionArray.Length == 0)
            {
                if (selectionArray != null)
                {
                    Marshal.ReleaseComObject(selectionArray);
                }
                Marshal.ReleaseComObject(textPattern);
                if (!ReferenceEquals(patternObj, textPattern) && patternObj != null)
                {
                    Marshal.ReleaseComObject(patternObj);
                }
                return;
            }

            IUIAutomationTextRange? range = null;
            try
            {
                range = selectionArray.GetElement(0);
            }
            catch
            {
                range = null;
            }

            if (range == null)
            {
                Marshal.ReleaseComObject(selectionArray);
                Marshal.ReleaseComObject(textPattern);
                if (!ReferenceEquals(patternObj, textPattern) && patternObj != null)
                {
                    Marshal.ReleaseComObject(patternObj);
                }
                return;
            }

            string? selectedText = null;
            try
            {
                selectedText = range.GetText(-1);
            }
            catch
            {
                selectedText = null;
            }

            selectedText = selectedText?.Trim();
            if (string.IsNullOrWhiteSpace(selectedText) || selectedText.Length < MinTextLength)
            {
                Cleanup(range, selectionArray, textPattern, patternObj);
                return;
            }

            double[] rects;
            try
            {
                rects = (double[])range.GetBoundingRectangles();
            }
            catch
            {
                rects = Array.Empty<double>();
            }

            SelectionBounds? bounds = null;
            if (rects.Length >= 4)
            {
                bounds = new SelectionBounds
                {
                    X = rects[0],
                    Y = rects[1],
                    Width = rects[2],
                    Height = rects[3]
                };
            }

            var signature = CreateSignature(selectedText, bounds);
            
            // Don't emit if this is the same as last emitted text
            if (signature == _lastTextSignature)
            {
                Cleanup(range, selectionArray, textPattern, patternObj);
                return;
            }

            _lastTextSignature = signature;
            _lastEmitTimestamp = now;

            var payload = new SelectionPayload
            {
                Text = selectedText,
                Bounds = bounds,
                Timestamp = now.ToUnixTimeMilliseconds()
            };

            var json = JsonSerializer.Serialize(payload, _jsonOptions);
            Console.WriteLine(json);
            Console.Out.Flush();
            
            var preview = selectedText.Length > 40 
                ? selectedText.Substring(0, 40) + "..." 
                : selectedText;
            Console.Error.WriteLine($"[OUTPUT] ✓ '{preview}'");

            Cleanup(range, selectionArray, textPattern, patternObj);
        }
        finally
        {
            Marshal.ReleaseComObject(focusedElement);
        }
    }

    private static string CreateSignature(string text, SelectionBounds? bounds)
    {
        if (bounds == null)
        {
            return text;
        }
        return $"{text}|{Math.Round(bounds.X)}|{Math.Round(bounds.Y)}";
    }

    private static void Cleanup(IUIAutomationTextRange range,
        IUIAutomationTextRangeArray selectionArray,
        IUIAutomationTextPattern textPattern,
        object? patternObj)
    {
        Marshal.ReleaseComObject(range);
        Marshal.ReleaseComObject(selectionArray);
        Marshal.ReleaseComObject(textPattern);
        if (patternObj != null && !ReferenceEquals(patternObj, textPattern))
        {
            Marshal.ReleaseComObject(patternObj);
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    private delegate void WinEventDelegate(IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime);
}

internal sealed class SelectionPayload
{
    public string? Text { get; set; }
    public SelectionBounds? Bounds { get; set; }
    public long Timestamp { get; set; }
}

internal sealed class SelectionBounds
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}