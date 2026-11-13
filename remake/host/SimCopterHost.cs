using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// No URL reservation, administrator rights or installed development runtime required.
internal static class SimCopterHost {
    static readonly string Root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
    static readonly Dictionary<string,string> Types=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){
        {".html","text/html; charset=utf-8"},{".css","text/css; charset=utf-8"},{".js","application/javascript; charset=utf-8"},
        {".json","application/json"},{".bin","application/octet-stream"},{".glb","model/gltf-binary"},
        {".wav","audio/wav"},{".mp3","audio/mpeg"},{".webmanifest","application/manifest+json"},
        {".png","image/png"},{".webp","image/webp"},{".svg","image/svg+xml"}};
    static readonly HashSet<string> Audio=new HashSet<string>(StringComparer.OrdinalIgnoreCase){
        "COPLOOP.WAV","BLIP1.WAV","CA_CHING.WAV","CHOPSTAR.WAV","TSCREECH.WAV","SIREN.WAV",
        "FIRESTAR.WAV","WATERCAN.WAV","FIREDMG.WAV","GASOUT.WAV","CRSH2.WAV","SOFTBMP2.WAV"};
    static long last=DateTime.UtcNow.Ticks;
    static int port;
    static string Url {get{return "http://127.0.0.1:"+port+"/remake/";}}
    static string Token {get{return "simcopter-flight-v1:"+Root;}}
    static bool Allowed(string p) {
        if (p.StartsWith("models/",StringComparison.Ordinal)) return p.EndsWith(".glb",StringComparison.OrdinalIgnoreCase) || (p.StartsWith("models/fleet/",StringComparison.Ordinal)&&p.EndsWith(".png",StringComparison.OrdinalIgnoreCase));
        if(p.StartsWith("SIMCOPT/SOUND/",StringComparison.Ordinal))return Audio.Contains(p.Substring(14));
        return p=="remake/index.html" || p=="remake/style.css" || p=="remake/mobile.css" || p=="remake/original.css" ||
            p=="remake/manifest.webmanifest" || p.StartsWith("remake/src/",StringComparison.Ordinal) || p.StartsWith("remake/vendor/three/",StringComparison.Ordinal) || p.StartsWith("remake/data/",StringComparison.Ordinal) || p.StartsWith("remake/art/",StringComparison.Ordinal);
    }
    static void Head(Stream s,int status,string type,long size){
        string phrase=status==200?"OK":status==404?"Not Found":status==405?"Method Not Allowed":"Bad Request";
        string h="HTTP/1.1 "+status+" "+phrase+"\r\nContent-Type: "+type+"\r\nContent-Length: "+size.ToString(CultureInfo.InvariantCulture)+"\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-cache\r\n\r\n";
        byte[] b=Encoding.ASCII.GetBytes(h);s.Write(b,0,b.Length);
    }
    static void Client(object state){
        using(var c=(TcpClient)state){
            try {
                c.ReceiveTimeout=5000;c.SendTimeout=25000;c.NoDelay=true;
                using(var s=c.GetStream()){
                    var buf=new byte[12288];int n=0;
                    while(n<buf.Length){int k=s.Read(buf,n,buf.Length-n);if(k==0)return;n+=k;if(Encoding.ASCII.GetString(buf,0,n).Contains("\r\n\r\n"))break;}
                    string[] lines=Encoding.ASCII.GetString(buf,0,n).Split(new[]{"\r\n"},StringSplitOptions.None);
                    string[] req=lines[0].Split(' ');string host="";
                    foreach(string line in lines){if(line.StartsWith("Host:",StringComparison.OrdinalIgnoreCase))host=line.Substring(5).Trim();}
                    if(req.Length!=3 || host!="127.0.0.1:"+port || !req[1].StartsWith("/")){Head(s,400,"text/plain",0);return;}
                    if(req[0]!="GET"&&req[0]!="HEAD"){Head(s,405,"text/plain",0);return;}
                    string p=Uri.UnescapeDataString(req[1].Split('?')[0]).TrimStart('/');
                    if(p.Contains("..")||p.Contains("\\")||p.Contains(":")||p.Contains("\0")){Head(s,400,"text/plain",0);return;}
                    Interlocked.Exchange(ref last,DateTime.UtcNow.Ticks);
                    if(p=="health"){byte[] b=Encoding.UTF8.GetBytes(Token);Head(s,200,"text/plain; charset=utf-8",b.Length);if(req[0]=="GET")s.Write(b,0,b.Length);return;}
                    if(p==""||p=="remake"||p=="remake/")p="remake/index.html";
                    string type;
                    if(!Allowed(p)||!Types.TryGetValue(Path.GetExtension(p),out type)){Head(s,404,"text/plain",0);return;}
                    string f=Path.GetFullPath(Path.Combine(Root,p));
                    if(!f.StartsWith(Root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!File.Exists(f)){Head(s,404,"text/plain",0);return;}
                    using(var file=new FileStream(f,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)){Head(s,200,type,file.Length);if(req[0]=="GET")file.CopyTo(s,65536);}
                }
            } catch(IOException){} catch(SocketException){} catch(ArgumentException){} catch(UnauthorizedAccessException){} catch(UriFormatException){}
        }
    }
    static void OpenBrowser(){
        foreach(string basePath in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}){
            foreach(string sub in new[]{@"Microsoft\Edge\Application\msedge.exe",@"Google\Chrome\Application\chrome.exe"}){
                string exe=Path.Combine(basePath,sub);if(!File.Exists(exe))continue;
                string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SimCopterFan","FlightBrowser");
                Directory.CreateDirectory(profile);
                var start=new ProcessStartInfo(exe,"--no-first-run --disable-default-apps --user-data-dir=\""+profile+"\" --app="+Url+" --start-maximized");
                start.UseShellExecute=false;Process.Start(start);return;
            }
        }
        Process.Start(new ProcessStartInfo(Url){UseShellExecute=true});
    }
    [STAThread] public static int Main(string[] args) {
        bool serve=Array.IndexOf(args,"--serve")>=0;
        try{
            TcpListener listener=null;
            for(port=42861;port<42881;port++){
                try{listener=new TcpListener(IPAddress.Loopback,port);listener.Start();break;}
                catch(SocketException){listener=null;try{using(var wc=new WebClient()){wc.Encoding=Encoding.UTF8;wc.Proxy=null;if(wc.DownloadString("http://127.0.0.1:"+port+"/health")==Token){if(!serve)OpenBrowser();Console.WriteLine(Url);return 0;}}}catch(WebException){}}
            }
            if(listener==null)throw new IOException("Could not open local flight server.");
            Console.WriteLine(Url);
            if(!serve)OpenBrowser();
            while(serve || DateTime.UtcNow.Ticks-Interlocked.Read(ref last)<TimeSpan.FromMinutes(12).Ticks){
                if(listener.Pending()){ThreadPool.QueueUserWorkItem(Client,listener.AcceptTcpClient());}else Thread.Sleep(12);
            }
            listener.Stop();return 0;
        }catch(Exception e){if(serve)Console.Error.WriteLine(e);else MessageBox.Show(e.Message,"SimCopter",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
