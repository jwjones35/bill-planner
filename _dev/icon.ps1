# Draws the app icon: a calendar page with a dollar sign on a green background.
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
function Draw([int]$size, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $s = $size / 512.0
    # Background gradient (full square: iOS and Android round the corners themselves)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(22, 140, 112)), ([System.Drawing.Color]::FromArgb(10, 84, 68)), 90
    $g.FillRectangle($bg, $rect)
    # Calendar page
    $px = 116 * $s; $py = 120 * $s; $pw = 280 * $s; $ph = 280 * $s; $r = 34 * $s
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($px, $py, $r * 2, $r * 2, 180, 90); $path.AddArc($px + $pw - $r * 2, $py, $r * 2, $r * 2, 270, 90)
    $path.AddArc($px + $pw - $r * 2, $py + $ph - $r * 2, $r * 2, $r * 2, 0, 90); $path.AddArc($px, $py + $ph - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath([System.Drawing.Brushes]::White, $path)
    # Calendar header band
    $g.SetClip($path)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 196, 61))), $px, $py, $pw, 70 * $s)
    $g.ResetClip()
    # Binder rings
    $ring = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 245, 241))
    foreach ($rx in 186, 304) { $g.FillEllipse($ring, $rx * $s, 96 * $s, 22 * $s, 52 * $s) }
    # Dollar sign
    $font = New-Object System.Drawing.Font 'Segoe UI', (150 * $s), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(12, 96, 77))
    $g.DrawString('$', $font, $ink, (New-Object System.Drawing.RectangleF $px, (186 * $s), $pw, (214 * $s)), $fmt)
    $g.Dispose()
    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Draw 512 'icon-512.png'
Draw 192 'icon-192.png'
Draw 180 'apple-touch-icon.png'
