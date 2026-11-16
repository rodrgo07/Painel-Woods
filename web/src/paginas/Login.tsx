import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { mensagem } from '../lib/dados.ts';
import { Marca } from '../componentes/ui.tsx';

/** Só entrar: não há cadastro pelo painel. A conta é criada no Supabase (veja web/README.md) */
export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro(/invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : mensagem(error));
  }

  return (
    <main className="login">
      <form className="login-cartao" onSubmit={entrar}>
        <Marca />
        <div>
          <h1>Entrar</h1>
          <p className="suave">Painel privado dos sites gerados pelo Painel Woods.</p>
        </div>
        <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Senha<input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        {erro && <p className="erro-form" role="alert">{erro}</p>}
        <button type="submit" className="btn primario" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}
