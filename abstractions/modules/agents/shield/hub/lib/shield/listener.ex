defmodule Shield.Listener do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, [], name: __MODULE__)

  def init(_) do
    path = System.fetch_env!("SHIELD_SOCKET")
    recover(path)

    {:ok, socket} =
      :gen_tcp.listen(0, [
        :binary,
        active: false,
        packet: :raw,
        ifaddr: {:local, String.to_charlist(path)},
        backlog: 64,
        send_timeout: 1000,
        send_timeout_close: true
      ])

    File.chmod!(path, 0o600)
    acceptor = spawn_link(fn -> accept(socket) end)
    {:ok, %{socket: socket, path: path, acceptor: acceptor}}
  end

  defp recover(path) do
    case File.lstat(path) do
      {:error, :enoent} ->
        :ok

      {:ok, %{type: :other, uid: uid}} ->
        if uid != current_uid(), do: raise("socket_owner")
        {_, socket_type} = System.cmd("/bin/test", ["-S", path])
        if socket_type != 0, do: raise("unsafe_socket_path")

        case :gen_tcp.connect(
               {:local, String.to_charlist(path)},
               0,
               [:binary, active: false],
               1000
             ) do
          {:error, :econnrefused} ->
            File.rm!(path)

          {:ok, socket} ->
            :gen_tcp.close(socket)
            raise("hub_already_running")

          {:error, reason} ->
            raise("socket_unavailable: #{inspect(reason)}")
        end

      _ ->
        raise("unsafe_socket_path")
    end
  end

  defp current_uid do
    {uid, 0} = System.cmd("/usr/bin/id", ["-u"])
    String.to_integer(String.trim(uid))
  end

  defp accept(socket) do
    case :gen_tcp.accept(socket) do
      {:ok, client} ->
        {:ok, pid} = Shield.Connection.start(client)
        :ok = :gen_tcp.controlling_process(client, pid)
        send(pid, :activate)
        accept(socket)

      {:error, :closed} ->
        :ok

      {:error, reason} ->
        exit(reason)
    end
  end

  def handle_call(:close, _, s) do
    :gen_tcp.close(s.socket)
    File.rm!(s.path)
    {:reply, :ok, s}
  end
end
