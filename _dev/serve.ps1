param([string]$Root = (Split-Path $PSScriptRoot -Parent), [int]$Port = 8770)
# Tiny static file server for testing Bill Planner on this PC.
# Stop it by opening http://127.0.0.1:<port>/quit
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
            '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://127.0.0.1:$Port/")
$l.Start()
while ($l.IsListening) {
    $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
    $p = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($p -eq '/quit') { $res.Close(); break }
    if ($p.EndsWith('/')) { $p += 'index.html' }
    $rel = ($p.TrimStart('/') -replace '/', '\')
    $file = Join-Path $Root $rel
    $full = [System.IO.Path]::GetFullPath($file)
    if ($full.StartsWith($Root) -and -not $rel.StartsWith('_dev') -and -not $rel.StartsWith('.git') -and (Test-Path $full -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
        $res.Headers.Add('Cache-Control', 'no-store')
        $buf = [System.IO.File]::ReadAllBytes($full)
        $res.OutputStream.Write($buf, 0, $buf.Length)
    } else { $res.StatusCode = 404 }
    $res.Close()
}
$l.Stop()
