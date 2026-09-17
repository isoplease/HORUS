param(
  [string]$Source = (Join-Path $PSScriptRoot '..\icons\teoh-alt1.png'),
  [string]$GlowOutput = (Join-Path $PSScriptRoot '..\icons\teoh-alt1-glow.png'),
  [string]$SquareOutput = (Join-Path $PSScriptRoot '..\icons\teoh-alt1-glow-app.png')
)

$drawingAssembly = Join-Path $PSHOME 'System.Drawing.Common.dll'
$primitiveAssembly = Join-Path $PSHOME 'System.Drawing.Primitives.dll'
$windowsCore = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'System.Private.Windows.Core.dll'
$gdiPlus = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'System.Private.Windows.GdiPlus.dll'

Add-Type -ReferencedAssemblies @($drawingAssembly, $primitiveAssembly, $windowsCore, $gdiPlus) -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class HorusIconGlow
{
    private static byte[] Blur(byte[] input, int width, int height, int radius)
    {
        byte[] horizontal = new byte[input.Length];
        byte[] output = new byte[input.Length];
        int diameter = radius * 2 + 1;

        for (int y = 0; y < height; y++)
        {
            int sum = 0;
            for (int x = -radius; x <= radius; x++)
                sum += input[y * width + Math.Max(0, Math.Min(width - 1, x))];
            for (int x = 0; x < width; x++)
            {
                horizontal[y * width + x] = (byte)(sum / diameter);
                int removeX = Math.Max(0, x - radius);
                int addX = Math.Min(width - 1, x + radius + 1);
                sum += input[y * width + addX] - input[y * width + removeX];
            }
        }

        for (int x = 0; x < width; x++)
        {
            int sum = 0;
            for (int y = -radius; y <= radius; y++)
                sum += horizontal[Math.Max(0, Math.Min(height - 1, y)) * width + x];
            for (int y = 0; y < height; y++)
            {
                output[y * width + x] = (byte)(sum / diameter);
                int removeY = Math.Max(0, y - radius);
                int addY = Math.Min(height - 1, y + radius + 1);
                sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
            }
        }
        return output;
    }

    public static void Create(string sourcePath, string glowPath, string squarePath)
    {
        using (Bitmap sourceLoaded = new Bitmap(sourcePath))
        using (Bitmap source = new Bitmap(sourceLoaded.Width, sourceLoaded.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics graphics = Graphics.FromImage(source))
            {
                graphics.Clear(Color.Transparent);
                graphics.DrawImageUnscaled(sourceLoaded, 0, 0);
            }

            Rectangle bounds = new Rectangle(0, 0, source.Width, source.Height);
            BitmapData sourceData = source.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int byteCount = Math.Abs(sourceData.Stride) * source.Height;
            byte[] pixels = new byte[byteCount];
            Marshal.Copy(sourceData.Scan0, pixels, 0, byteCount);
            source.UnlockBits(sourceData);

            byte[] alpha = new byte[source.Width * source.Height];
            for (int y = 0; y < source.Height; y++)
                for (int x = 0; x < source.Width; x++)
                    alpha[y * source.Width + x] = pixels[y * sourceData.Stride + x * 4 + 3];

            byte[] blurred = alpha;
            for (int pass = 0; pass < 3; pass++) blurred = Blur(blurred, source.Width, source.Height, 14);

            byte[] result = (byte[])pixels.Clone();
            for (int y = 0; y < source.Height; y++)
            {
                for (int x = 0; x < source.Width; x++)
                {
                    int pixelIndex = y * sourceData.Stride + x * 4;
                    if (result[pixelIndex + 3] != 0) continue;
                    int glowAlpha = (int)Math.Round(blurred[y * source.Width + x] * 0.34);
                    if (glowAlpha <= 0) continue;
                    result[pixelIndex] = 255;
                    result[pixelIndex + 1] = 211;
                    result[pixelIndex + 2] = 104;
                    result[pixelIndex + 3] = (byte)Math.Min(255, glowAlpha);
                }
            }

            using (Bitmap glow = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
            {
                BitmapData glowData = glow.LockBits(bounds, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                Marshal.Copy(result, 0, glowData.Scan0, byteCount);
                glow.UnlockBits(glowData);
                glow.Save(glowPath, ImageFormat.Png);

                int side = Math.Max(glow.Width, glow.Height);
                using (Bitmap square = new Bitmap(side, side, PixelFormat.Format32bppArgb))
                using (Graphics graphics = Graphics.FromImage(square))
                {
                    graphics.Clear(Color.Transparent);
                    graphics.DrawImageUnscaled(glow, (side - glow.Width) / 2, (side - glow.Height) / 2);
                    square.Save(squarePath, ImageFormat.Png);
                }
            }
        }
    }
}
'@

[HorusIconGlow]::Create(
  (Resolve-Path -LiteralPath $Source).Path,
  [System.IO.Path]::GetFullPath($GlowOutput),
  [System.IO.Path]::GetFullPath($SquareOutput)
)
