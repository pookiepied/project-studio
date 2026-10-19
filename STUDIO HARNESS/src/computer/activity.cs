using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Studio {
    // No key values, button identities or input history cross this boundary.
    public sealed class InputSummary {
        public bool Available;
        public int Moves, Buttons, Wheels, Keys;
        public long AgeMs;
        public bool Truncated;
    }

    public sealed class Activity : IDisposable {
        private delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int kind, Hook callback, IntPtr module, uint thread);
        [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
        private readonly object gate = new object();
        private readonly ManualResetEvent ready = new ManualResetEvent(false);
        private readonly Hook mouse, keyboard;
        private Thread thread;
        private Marker marker;
        private IntPtr mouseHook, keyboardHook;
        private long lastAt, showUntil;
        private int moves, buttons, wheels, keys;
        private bool available, truncated, stopped;
        public Activity() { mouse = Mouse; keyboard = Keyboard; }

        public void Start() {
            lock (gate) {
                if (thread != null || stopped) return;
                thread = new Thread(Run); thread.IsBackground = true;
                thread.SetApartmentState(ApartmentState.STA); thread.Start();
            }
            ready.WaitOne(2000);
        }
        public void Pulse() { lock (gate) { showUntil = Stopwatch.GetTimestamp() + Stopwatch.Frequency * 2; } }
        public bool IsOverlay(long handle) { lock (gate) { return marker != null && marker.NativeHandle == new IntPtr(handle); } }

        // These pure policies are also exercised without installing any hooks.
        public static string Classify(bool isKeyboard, int message, int flags) {
            if ((flags & (isKeyboard ? 0x12 : 0x03)) != 0) return "";
            if (isKeyboard) return message >= 0x100 && message <= 0x101 || message >= 0x104 && message <= 0x105 ? "keyboard" : "";
            if (message == 0x200) return "mouse_move";
            if (message == 0x20A || message == 0x20E) return "mouse_wheel";
            return message == 0x201 || message == 0x202 || message == 0x204 || message == 0x205 || message == 0x207 || message == 0x208 || message == 0x20B || message == 0x20C ? "mouse_button" : "";
        }
        public void Record(string kind) {
            if (kind != "mouse_move" && kind != "mouse_button" && kind != "mouse_wheel" && kind != "keyboard") return;
            lock (gate) {
                lastAt = Stopwatch.GetTimestamp(); showUntil = 0;
                if (kind == "mouse_move") Increment(ref moves);
                else if (kind == "mouse_button") Increment(ref buttons);
                else if (kind == "mouse_wheel") Increment(ref wheels);
                else Increment(ref keys);
            }
        }
        private void Increment(ref int count) { if (count < 1000000) count++; else truncated = true; }
        public InputSummary Read() {
            lock (gate) {
                InputSummary value = new InputSummary { Available = available,
                    Moves = moves, Buttons = buttons, Wheels = wheels, Keys = keys,
                    AgeMs = lastAt == 0 ? 0 : (Stopwatch.GetTimestamp() - lastAt) * 1000 / Stopwatch.Frequency, Truncated = truncated };
                moves = buttons = wheels = keys = 0; truncated = false;
                return value;
            }
        }
        private IntPtr Mouse(int code, IntPtr message, IntPtr data) {
            if (code >= 0) Record(Classify(false, message.ToInt32(), Marshal.ReadInt32(data, 12)));
            return CallNextHookEx(mouseHook, code, message, data);
        }
        private IntPtr Keyboard(int code, IntPtr message, IntPtr data) {
            // Only flags are read, never virtual keys or scan codes.
            if (code >= 0) Record(Classify(true, message.ToInt32(), Marshal.ReadInt32(data, 8)));
            return CallNextHookEx(keyboardHook, code, message, data);
        }
        private void Run() {
            try {
                using (Marker view = new Marker())
                using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer()) {
                    lock (gate) { marker = view; }
                    IntPtr module = GetModuleHandle(null);
                    mouseHook = SetWindowsHookEx(14, mouse, module, 0);
                    keyboardHook = SetWindowsHookEx(13, keyboard, module, 0);
                    lock (gate) { available = mouseHook != IntPtr.Zero && keyboardHook != IntPtr.Zero; }
                    timer.Interval = 16;
                    timer.Tick += delegate {
                        bool end, show;
                        lock (gate) { end = stopped; show = showUntil > Stopwatch.GetTimestamp(); }
                        if (end) { Application.ExitThread(); return; }
                        Point point;
                        if (show && GetCursorPos(out point)) {
                            Rectangle area = Screen.FromPoint(point).Bounds;
                            view.Location = new Point(Math.Max(area.Left, Math.Min(area.Right - view.Width, point.X - 11)),
                                Math.Max(area.Top, Math.Min(area.Bottom - view.Height, point.Y - 11)));
                            if (!view.Visible) view.Show();
                        } else if (view.Visible) view.Hide();
                    };
                    timer.Start(); ready.Set();
                    Application.Run();
                }
            } catch { ready.Set(); }
            finally {
                if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
                if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
                lock (gate) { available = false; marker = null; }
            }
        }
        public void Dispose() { lock (gate) { stopped = true; showUntil = 0; } if (thread != null) thread.Join(1000); }

        private sealed class Marker : Form {
            public readonly IntPtr NativeHandle;
            public Marker() {
                FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
                BackColor = Color.Magenta; TransparencyKey = Color.Magenta;
                ClientSize = new Size(92, 32); DoubleBuffered = true; NativeHandle = Handle;
            }
            protected override bool ShowWithoutActivation { get { return true; } }
            protected override CreateParams CreateParams {
                get { CreateParams value = base.CreateParams; value.ExStyle |= 0x080800A0; return value; }
            }
            protected override void WndProc(ref Message message) {
                if (message.Msg == 0x84) { message.Result = new IntPtr(-1); return; }
                if (message.Msg == 0x21) { message.Result = new IntPtr(3); return; }
                base.WndProc(ref message);
            }
            protected override void OnPaint(PaintEventArgs args) {
                using (Pen ring = new Pen(Color.FromArgb(155, 135, 245), 2))
                using (Brush fill = new SolidBrush(Color.FromArgb(49, 42, 72)))
                using (Brush ink = new SolidBrush(Color.White)) {
                    args.Graphics.DrawEllipse(ring, 1, 1, 20, 20);
                    args.Graphics.FillRectangle(fill, 27, 5, 62, 23);
                    args.Graphics.DrawString("Studio", SystemFonts.MessageBoxFont, ink, 32, 8);
                }
            }
        }
    }
}
