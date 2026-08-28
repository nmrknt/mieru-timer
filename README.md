# みえるタイマー

iPhone Safariで使える、1周60分固定のビジュアルタイマーです。

## iPhoneで使う

1. このフォルダをHTTPSで公開します（GitHub Pages、Netlify、Cloudflare Pagesなど）。
2. 公開URLをiPhoneのSafariで開きます。
3. 画面下の「共有」ボタン（四角から上矢印）をタップします。
4. 「ホーム画面に追加」を選び、右上の「追加」をタップします。
5. ホーム画面の「タイマー」アイコンから起動します。

初回に一度オンラインで開けば、以後はオフラインでも動作します。終了音を有効にするため、必ず「スタート」ボタンから開始してください。iOSの仕様上、画面をロックしたりSafariを完全に閉じたりすると、終了音は保証されません。

## パソコンで試す

Service Workerは `file://` では動かないため、ローカルWebサーバー経由で開いてください。

```text
python -m http.server 8000
```

その後、ブラウザで `http://localhost:8000/outputs/mieru-timer/` を開きます。
