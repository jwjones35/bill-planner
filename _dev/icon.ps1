# Draws the app icon in the app's inked-comic style: a calendar page with a dollar sign, thick black outlines,
# a hard drop shadow and halftone dots on a deep purple background (the dark theme's colors).
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
function C([int]$r, [int]$g, [int]$b, [int]$a = 255) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }
function RoundRect([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r * 2, $r * 2, 180, 90); $p.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $p.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90); $p.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure(); return $p
}
function Draw([int]$size, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $s = $size / 512.0
    $ink = C 4 2 11
    # Background: deep purple, lighter toward the top (full square: phones round the corners themselves)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (C 46 34 96), (C 17 13 34), 90
    $g.FillRectangle($bg, $rect)
    # Halftone dots, bigger toward the bottom right, like old printed comics
    $dot = New-Object System.Drawing.SolidBrush (C 0 0 0 70)
    $step = 22 * $s
    for ($yy = 0; $yy -lt $size + $step; $yy += $step) {
        $row = [int]($yy / $step)
        for ($xx = (($row % 2) * $step / 2); $xx -lt $size + $step; $xx += $step) {
            $t = ($xx + $yy) / (2.0 * $size)
            $d = [Math]::Max(0, ($t - 0.25)) * 14 * $s
            if ($d -gt 0.4) { $g.FillEllipse($dot, $xx - $d / 2, $yy - $d / 2, $d, $d) }
        }
    }
    # Calendar page: hard drop shadow, then the page with a thick ink outline
    $px = 110 * $s; $py = 118 * $s; $pw = 280 * $s; $ph = 284 * $s; $r = 34 * $s; $lw = 14 * $s
    $shadow = RoundRect ($px + 18 * $s) ($py + 18 * $s) $pw $ph $r
    $g.FillPath((New-Object System.Drawing.SolidBrush $ink), $shadow)
    $page = RoundRect $px $py $pw $ph $r
    $g.FillPath((New-Object System.Drawing.SolidBrush (C 255 252 246)), $page)
    # Header band in comic yellow-orange, with a light shine stripe
    $g.SetClip($page)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush (C 255 181 46)), $px, $py, $pw, 78 * $s)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush (C 255 255 255 90)), $px, $py + 10 * $s, $pw, 10 * $s)
    $g.ResetClip()
    $pen = New-Object System.Drawing.Pen $ink, $lw
    $pen.LineJoin = 'Round'
    $g.DrawLine($pen, $px, $py + 78 * $s, $px + $pw, $py + 78 * $s)
    $g.DrawPath($pen, $page)
    # Binder rings: ink with a teal highlight
    foreach ($rx in 178, 300) {
        $g.FillPath((New-Object System.Drawing.SolidBrush $ink), (RoundRect ($rx * $s) (86 * $s) (28 * $s) (66 * $s) (14 * $s)))
        $g.FillPath((New-Object System.Drawing.SolidBrush (C 31 209 170)), (RoundRect (($rx + 7) * $s) (93 * $s) (14 * $s) (40 * $s) (7 * $s)))
    }
    # Dollar sign: teal, outlined in ink, with a hard offset shadow
    $fam = New-Object System.Drawing.FontFamily 'Segoe UI Black'
    if ($fam.Name -ne 'Segoe UI Black') { $fam = New-Object System.Drawing.FontFamily 'Segoe UI' }
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $box = New-Object System.Drawing.RectangleF $px, (196 * $s), $pw, (206 * $s)
    $em = 170 * $s
    $txtShadow = New-Object System.Drawing.Drawing2D.GraphicsPath
    $txtShadow.AddString('$', $fam, [int][System.Drawing.FontStyle]::Bold, $em, (New-Object System.Drawing.RectangleF ($box.X + 10 * $s), ($box.Y + 10 * $s), $box.Width, $box.Height), $fmt)
    $g.FillPath((New-Object System.Drawing.SolidBrush $ink), $txtShadow)
    $txt = New-Object System.Drawing.Drawing2D.GraphicsPath
    $txt.AddString('$', $fam, [int][System.Drawing.FontStyle]::Bold, $em, $box, $fmt)
    $tpen = New-Object System.Drawing.Pen $ink, (10 * $s); $tpen.LineJoin = 'Round'
    $g.DrawPath($tpen, $txt)
    $g.FillPath((New-Object System.Drawing.SolidBrush (C 0 160 134)), $txt)
    $g.Dispose()
    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Draw 512 'icon-512.png'
Draw 192 'icon-192.png'
Draw 180 'apple-touch-icon.png'
