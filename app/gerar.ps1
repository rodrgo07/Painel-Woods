# Gera o Woods.exe na pasta do painel:  powershell -ExecutionPolicy Bypass -File app\gerar.ps1
$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot
$raiz = Split-Path $app

# Ícone: quadrado vermelho-escuro com o "W" do logo (PNG dentro de um .ico)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(142, 27, 27))), 0, 0, 256, 256)
$caneta = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245, 241, 239)), 21
$caneta.LineJoin = 'Round'; $caneta.StartCap = 'Round'; $caneta.EndCap = 'Round'
$g.DrawLines($caneta, [System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF 56, 80), (New-Object System.Drawing.PointF 84, 176),
  (New-Object System.Drawing.PointF 128, 96), (New-Object System.Drawing.PointF 172, 176),
  (New-Object System.Drawing.PointF 200, 80)))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)                    # cabeçalho: 1 imagem
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)       # 256x256
$w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
$w.Write($png)
[System.IO.File]::WriteAllBytes("$app\woods.ico", $ico.ToArray())

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /optimize /r:System.Windows.Forms.dll /r:System.Management.dll /win32icon:"$app\woods.ico" /out:"$raiz\Woods.exe" "$app\Woods.cs"
if ($LASTEXITCODE) { throw "csc falhou" }
"Gerado: $raiz\Woods.exe"
