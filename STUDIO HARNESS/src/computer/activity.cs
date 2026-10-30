using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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
                            view.Follow(point, area);
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

        // Same arrow geometry and rounded Studio badge as BrowserWindow.tsx.
        // Paint our own badge, never a native tooltip or a global cursor change.
        public static void PaintCursor(Graphics graphics, Point hotspot, Size size) {
            GraphicsState state = graphics.Save();
            try {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                using (Brush fill = new SolidBrush(Color.FromArgb(30, 30, 30)))
                using (Brush ink = new SolidBrush(Color.White))
                using (Pen outline = new Pen(Color.White, 1.5f))
                using (Font font = new Font("Segoe UI", 8, FontStyle.Regular, GraphicsUnit.Point))
                using (GraphicsPath arrow = new GraphicsPath())
                using (GraphicsPath badge = new GraphicsPath()) {
                    arrow.AddPolygon(new Point[] { new Point(hotspot.X, hotspot.Y), new Point(hotspot.X + 8, hotspot.Y + 22),
                        new Point(hotspot.X + 11, hotspot.Y + 13), new Point(hotspot.X + 20, hotspot.Y + 10) });
                    outline.LineJoin = LineJoin.Round;
                    graphics.FillPath(fill, arrow); graphics.DrawPath(outline, arrow);
                    int x = Math.Max(0, Math.Min(size.Width - 56, hotspot.X + 12));
                    int y = hotspot.Y + 26 + 20 <= size.Height ? hotspot.Y + 26 : Math.Max(0, hotspot.Y - 24);
                    badge.AddArc(x, y, 20, 20, 90, 180);
                    badge.AddArc(x + 36, y, 20, 20, 270, 180); badge.CloseFigure();
                    graphics.FillPath(fill, badge);
                    graphics.DrawString("Studio", font, ink, x + 9, y + 2);
                }
            } finally { graphics.Restore(state); }
        }

        private sealed class Marker : Form {
            [StructLayout(LayoutKind.Sequential)] private struct Blend {
                public byte Operation, Flags, Alpha, Format;
            }
            [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
            [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
            [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
            [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
            [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
            [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
            [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr screen, ref Point position,
                ref Size size, IntPtr source, ref Point origin, int key, ref Blend blend, int flags);
            public readonly IntPtr NativeHandle;
            private Point hotspot = new Point(2, 2);
            public Marker() {
                FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
                ClientSize = new Size(92, 56); DoubleBuffered = true; NativeHandle = Handle;
            }
            public void Follow(Point point, Rectangle area) {
                Point location = new Point(Math.Max(area.Left, Math.Min(area.Right - Width, point.X - 2)),
                    Math.Max(area.Top, Math.Min(area.Bottom - Height, point.Y - 2)));
                Point next = new Point(point.X - location.X, point.Y - location.Y);
                bool redraw = hotspot != next || !Visible;
                hotspot = next;
                Location = location;
                if (redraw) PaintLayer();
            }
            // Per-pixel alpha keeps antialiased edges neutral instead of blending into a colour key.
            private void PaintLayer() {
                using (Bitmap bitmap = new Bitmap(Width, Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                    using (Graphics graphics = Graphics.FromImage(bitmap)) {
                        graphics.Clear(Color.Transparent);
                        PaintCursor(graphics, hotspot, ClientSize);
                    }
                    IntPtr screen = GetDC(IntPtr.Zero), source = CreateCompatibleDC(screen);
                    IntPtr pixels = bitmap.GetHbitmap(Color.FromArgb(0)), previous = SelectObject(source, pixels);
                    try {
                        Point position = Location, origin = Point.Empty; Size size = ClientSize;
                        Blend blend = new Blend { Alpha = 255, Format = 1 };
                        UpdateLayeredWindow(Handle, screen, ref position, ref size, source, ref origin, 0, ref blend, 2);
                    } finally {
                        SelectObject(source, previous); DeleteObject(pixels); DeleteDC(source); ReleaseDC(IntPtr.Zero, screen);
                    }
                }
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
        }
    }
}
