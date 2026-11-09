// Woods.exe: liga o servidor do painel (node servidor.js) escondido e abre a interface numa janela
// própria do Edge (modo app). Fechou a janela, o servidor desliga junto.
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class Woods
{
    const int Porta = 4300;

    [STAThread]
    static int Main()
    {
        string pasta = AppDomain.CurrentDomain.BaseDirectory;
        Process servidor = null;
        var log = new StringBuilder();

        // Já aberto (outra janela ou npm start): só abre mais uma janela
        if (!Aberta())
        {
            if (!File.Exists(Path.Combine(pasta, "servidor.js")))
                return Erro("Deixe o Woods.exe na pasta do painel, junto do servidor.js.");
            var psi = new ProcessStartInfo("node", "--env-file-if-exists=.env servidor.js")
            {
                WorkingDirectory = pasta, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            try { servidor = Process.Start(psi); }
            catch { return Erro("Não achei o Node.js. Instale em https://nodejs.org e abra de novo."); }
            servidor.OutputDataReceived += (s, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
            servidor.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
            servidor.BeginOutputReadLine();
            servidor.BeginErrorReadLine();

            for (int i = 0; i < 100 && !Aberta(); i++)
            {
                if (servidor.HasExited) { lock (log) return Erro("O servidor não abriu:\n\n" + log); }
                Thread.Sleep(200);
            }
            if (!Aberta()) { Parar(servidor); return Erro("O servidor demorou demais para abrir."); }
        }

        string edge = new[] {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        }.FirstOrDefaultExisting();
        if (edge == null) { Parar(servidor); return Erro("Não achei o Microsoft Edge."); }

        // Perfil próprio: a janela é um processo separado do Edge normal, então dá para esperar ela fechar
        string perfil = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PainelWoods");
        Process.Start(edge, "--app=http://localhost:" + Porta + " --user-data-dir=\"" + perfil
            + "\" --window-size=1440,900 --no-first-run --no-default-browser-check --disable-background-mode");
        // O Edge pode repassar o pedido para uma janela do painel já aberta e sair na hora:
        // espera até não sobrar nenhum Edge com o perfil do painel
        Thread.Sleep(3000);
        while (EdgeDoPainelAberto(perfil)) Thread.Sleep(1500);

        Parar(servidor);
        return 0;
    }

    static bool EdgeDoPainelAberto(string perfil)
    {
        using (var busca = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name = 'msedge.exe'"))
        using (var lista = busca.Get())
            foreach (System.Management.ManagementObject p in lista)
            {
                var linha = p["CommandLine"] as string;
                // Só o processo principal (sem --type=); auxiliares como o crashpad podem sobrar
                if (linha != null && linha.IndexOf(perfil, StringComparison.OrdinalIgnoreCase) >= 0
                    && linha.IndexOf("--type=", StringComparison.Ordinal) < 0) return true;
            }
        return false;
    }

    static bool Aberta()
    {
        try { using (var c = new TcpClient()) { c.Connect("127.0.0.1", Porta); return true; } }
        catch { return false; }
    }

    // Derruba o node e o que ele abriu (Claude, Playwright)
    static void Parar(Process p)
    {
        if (p == null || p.HasExited) return;
        Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false }).WaitForExit();
    }

    static int Erro(string msg)
    {
        MessageBox.Show(msg, "Painel Woods", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }
}

static class Ext
{
    public static string FirstOrDefaultExisting(this string[] caminhos)
    {
        foreach (var c in caminhos) if (File.Exists(c)) return c;
        return null;
    }
}
