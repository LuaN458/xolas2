using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

namespace XolasIconGenerator
{
    class Program
    {
        static GraphicsPath CreateRoundedRectangle(Rectangle rect, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            Rectangle arc = new Rectangle(rect.X, rect.Y, diameter, diameter);

            // Canto superior esquerdo
            path.AddArc(arc, 180, 90);

            // Canto superior direito
            arc.X = rect.Right - diameter;
            path.AddArc(arc, 270, 90);

            // Canto inferior direito
            arc.Y = rect.Bottom - diameter;
            path.AddArc(arc, 0, 90);

            // Canto inferior esquerdo
            arc.X = rect.Left;
            path.AddArc(arc, 90, 90);

            path.CloseFigure();
            return path;
        }

        static Bitmap DrawMasterIcon(int size)
        {
            Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);

                float scale = size / 256.0f;

                // 1. Fundo Obsidian Squircle (cantos arredondados)
                int margin = (int)(10 * scale);
                int rectSize = size - (margin * 2);
                int cornerRadius = (int)(54 * scale);
                Rectangle cardRect = new Rectangle(margin, margin, rectSize, rectSize);

                using (GraphicsPath cardPath = CreateRoundedRectangle(cardRect, cornerRadius))
                {
                    // Gradiente suave de fundo Obsidian
                    using (LinearGradientBrush bgBrush = new LinearGradientBrush(
                        cardRect,
                        Color.FromArgb(255, 14, 16, 24), // #0e1018
                        Color.FromArgb(255, 7, 8, 12),   // #07080c
                        LinearGradientMode.Vertical))
                    {
                        g.FillPath(bgBrush, cardPath);
                    }

                    // Glow interno roxo/índigo suave no topo
                    using (GraphicsPath glowPath = new GraphicsPath())
                    {
                        glowPath.AddEllipse(size * 0.15f, size * 0.05f, size * 0.7f, size * 0.5f);
                        using (PathGradientBrush pgb = new PathGradientBrush(glowPath))
                        {
                            pgb.CenterColor = Color.FromArgb(70, 99, 102, 241); // #6366f1
                            pgb.SurroundColors = new Color[] { Color.Transparent };
                            g.FillPath(pgb, cardPath);
                        }
                    }

                    // Borda sutil translúcida
                    using (Pen borderPen = new Pen(Color.FromArgb(55, 255, 255, 255), 2.0f * scale))
                    {
                        g.DrawPath(borderPen, cardPath);
                    }
                }

                // 2. Desenho do Emblema de Comando (⌘) do Xolas
                float cx = size / 2.0f;
                float cy = size / 2.0f;
                float loopOffset = 30.0f * scale;
                float loopRadius = 22.0f * scale;
                float penWidth = 14.0f * scale;

                // Tentar desenhar o glifo ⌘ com fonte do sistema primeiro
                bool drawnWithFont = false;
                string[] candidateFonts = { "Segoe UI Symbol", "Lucida Sans Unicode", "Arial", "Segoe UI" };
                foreach (string fontName in candidateFonts)
                {
                    try
                    {
                        using (Font font = new Font(fontName, 100 * scale, FontStyle.Bold, GraphicsUnit.Pixel))
                        {
                            using (StringFormat sf = new StringFormat())
                            {
                                sf.Alignment = StringAlignment.Center;
                                sf.LineAlignment = StringAlignment.Center;

                                CharacterRange[] ranges = { new CharacterRange(0, 1) };
                                sf.SetMeasurableCharacterRanges(ranges);
                                Region[] regions = g.MeasureCharacterRanges("\u2318", font, new RectangleF(0, 0, size, size), sf);
                                if (regions != null && regions.Length > 0 && regions[0].GetBounds(g).Width > 10)
                                {
                                    // Glow do símbolo
                                    using (SolidBrush glowBrush = new SolidBrush(Color.FromArgb(90, 99, 102, 241)))
                                    {
                                        for (int dx = -2; dx <= 2; dx += 2)
                                        {
                                            for (int dy = -2; dy <= 2; dy += 2)
                                            {
                                                g.DrawString("\u2318", font, glowBrush, new RectangleF(dx * scale, dy * scale, size, size), sf);
                                            }
                                        }
                                    }

                                    // Gradiente do símbolo: branco luminoso para índigo suave
                                    using (LinearGradientBrush symBrush = new LinearGradientBrush(
                                        new RectangleF(0, 0, size, size),
                                        Color.FromArgb(255, 255, 255, 255),
                                        Color.FromArgb(255, 205, 215, 255),
                                        LinearGradientMode.Vertical))
                                    {
                                        g.DrawString("\u2318", font, symBrush, new RectangleF(0, 0, size, size), sf);
                                    }
                                    drawnWithFont = true;
                                    break;
                                }
                            }
                        }
                    }
                    catch { }
                }

                // Se nenhuma fonte contiver ⌘, desenha geometricamente com Pen de alta precisão
                if (!drawnWithFont)
                {
                    using (Pen glowPen = new Pen(Color.FromArgb(90, 99, 102, 241), penWidth + (4 * scale)))
                    {
                        DrawCommandSymbolGeometry(g, glowPen, cx, cy, loopOffset, loopRadius);
                    }

                    using (Pen strokePen = new Pen(Color.FromArgb(255, 245, 248, 255), penWidth))
                    {
                        strokePen.StartCap = LineCap.Round;
                        strokePen.EndCap = LineCap.Round;
                        DrawCommandSymbolGeometry(g, strokePen, cx, cy, loopOffset, loopRadius);
                    }
                }
            }
            return bmp;
        }

        static void DrawCommandSymbolGeometry(Graphics g, Pen pen, float cx, float cy, float d, float r)
        {
            // Centro das 4 voltas
            PointF tl = new PointF(cx - d, cy - d);
            PointF tr = new PointF(cx + d, cy - d);
            PointF bl = new PointF(cx - d, cy + d);
            PointF br = new PointF(cx + d, cy + d);

            // Círculos dos 4 cantos
            g.DrawEllipse(pen, tl.X - r, tl.Y - r, r * 2, r * 2);
            g.DrawEllipse(pen, tr.X - r, tr.Y - r, r * 2, r * 2);
            g.DrawEllipse(pen, bl.X - r, bl.Y - r, r * 2, r * 2);
            g.DrawEllipse(pen, br.X - r, br.Y - r, r * 2, r * 2);

            // Linhas de conexão
            g.DrawLine(pen, tl.X, tl.Y, tr.X, tr.Y); // Topo
            g.DrawLine(pen, bl.X, bl.Y, br.X, br.Y); // Base
            g.DrawLine(pen, tl.X, tl.Y, bl.X, bl.Y); // Esquerda
            g.DrawLine(pen, tr.X, tr.Y, br.X, br.Y); // Direita
        }

        static void SaveMultiResolutionIco(string outputPath, int[] sizes)
        {
            List<byte[]> pngBuffers = new List<byte[]>();
            List<int> validSizes = new List<int>();

            foreach (int sz in sizes)
            {
                using (Bitmap bmp = DrawMasterIcon(sz))
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    pngBuffers.Add(ms.ToArray());
                    validSizes.Add(sz);
                }
            }

            using (FileStream fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
            using (BinaryWriter bw = new BinaryWriter(fs))
            {
                // ICONDIR Header (6 bytes)
                bw.Write((ushort)0); // idReserved
                bw.Write((ushort)1); // idType = 1 (ICO)
                bw.Write((ushort)validSizes.Count); // idCount

                int offset = 6 + (16 * validSizes.Count);

                // ICONDIRENTRY (16 bytes each)
                for (int i = 0; i < validSizes.Count; i++)
                {
                    int sz = validSizes[i];
                    bw.Write((byte)(sz >= 256 ? 0 : sz)); // bWidth
                    bw.Write((byte)(sz >= 256 ? 0 : sz)); // bHeight
                    bw.Write((byte)0); // bColorCount
                    bw.Write((byte)0); // bReserved
                    bw.Write((ushort)1); // wPlanes
                    bw.Write((ushort)32); // wBitCount
                    bw.Write((uint)pngBuffers[i].Length); // dwBytesInRes
                    bw.Write((uint)offset); // dwImageOffset

                    offset += pngBuffers[i].Length;
                }

                // PNG byte payloads
                for (int i = 0; i < pngBuffers.Count; i++)
                {
                    bw.Write(pngBuffers[i]);
                }
            }

            Console.WriteLine("Icone gerado com sucesso: " + outputPath);
        }

        static int Main(string[] args)
        {
            string outDir = args.Length > 0 ? args[0] : ".";
            string iconPath = Path.Combine(outDir, "icon.ico");
            int[] sizes = new int[] { 256, 128, 64, 48, 32, 24, 16 };

            SaveMultiResolutionIco(iconPath, sizes);
            return 0;
        }
    }
}
