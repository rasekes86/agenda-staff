package com.workoutevents.agendastaff.pdf;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT <= 28 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 4103);
        }

        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AgendaStaffPDF/3.0.3");

        webView.addJavascriptInterface(new AndroidFiles(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, FILE_CHOOSER_REQUEST); }
                catch (Exception error) { fileCallback = null; Toast.makeText(MainActivity.this, "No hay selector de archivos disponible", Toast.LENGTH_LONG).show(); }
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/mobile-index.html");
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        if (data != null && data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            result = new Uri[count];
            for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    public class AndroidFiles {
        @JavascriptInterface public void saveBase64File(String requestedName, String mimeType, String encoded) {
            final String name = requestedName.replaceAll("[\\\\/:*?\"<>|]", "_");
            final byte[] bytes;
            try { bytes = Base64.decode(encoded, Base64.DEFAULT); }
            catch (Exception error) { runOnUiThread(() -> Toast.makeText(MainActivity.this, "Archivo inválido", Toast.LENGTH_LONG).show()); return; }

            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Agenda Staff");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("No se pudo crear el archivo");
                    try (OutputStream stream = getContentResolver().openOutputStream(uri)) { stream.write(bytes); }
                } else {
                    File folder = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Agenda Staff");
                    if (!folder.exists() && !folder.mkdirs()) throw new Exception("No se pudo crear Descargas/Agenda Staff");
                    try (FileOutputStream stream = new FileOutputStream(new File(folder, name))) { stream.write(bytes); }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Guardado en Descargas/Agenda Staff", Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "No se pudo guardar: " + error.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }
}
