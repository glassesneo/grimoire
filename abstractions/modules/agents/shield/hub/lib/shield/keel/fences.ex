# A response's text split into plain runs and fenced code blocks. Only a line-start run of
# three or more backticks or tildes opens a block, and only a line of the same character, at
# least as long and with nothing but spaces or tabs around it, closes it; this is not a
# CommonMark parser. A block that is still open runs to the end and is marked `open`, so the
# ids of the blocks before it stay the same when its closing fence arrives.
#
# Line terminators other than LF stay inside a line, and a line that holds one never opens or
# closes a block, as in the projection keel had before (JavaScript's `.` and `$`).
defmodule Shield.Keel.Fences do
  @open ~r/\A[ \t]*(`{3,}|~{3,})([^\n\r\x{2028}\x{2029}]*)\z/u
  @close ~r/\A[ \t]*(`{3,}|~{3,})[ \t]*\z/u

  # `blocks` are finished, newest first; `text` is the plain run being read, its lines newest
  # first; `fence` is the open block, its body and source lines newest first.
  @empty %{blocks: [], text: nil, fence: nil}

  @doc """
  The blocks of `text`, `%{type: :text, text:}` or `%{type: :code, ...}`, reusing what `stream`
  returned for an earlier text, or nil. While a response
  grows, only its new lines are read, and the blocks its complete lines finished stay the
  same terms; a text that does not extend the earlier one is read from the start. The blocks
  are the same as when the whole text is read at once.
  """
  def stream(text, nil), do: stream(text, %{source: "", start: 0, state: @empty})

  def stream(text, %{source: source} = s) do
    s =
      if String.starts_with?(text, source),
        do: s,
        else: %{source: "", start: 0, state: @empty}

    {state, start} = complete_lines(text, byte_size(s.source), s.start, s.state)
    rest = binary_part(text, start, byte_size(text) - start)
    {finish(line(rest, state)), %{source: text, start: start, state: state}}
  end

  # Reads the lines that end at an LF at or after `from`, the first one starting at `start`.
  # Each line is copied, so the state keeps no earlier text alive.
  defp complete_lines(text, from, start, state) do
    case :binary.match(text, "\n", scope: {from, byte_size(text) - from}) do
      {at, 1} ->
        state = line(:binary.copy(binary_part(text, start, at - start)), state)
        complete_lines(text, at + 1, at + 1, state)

      :nomatch ->
        {state, start}
    end
  end

  defp finish(state) do
    blocks =
      case state.fence do
        nil -> flush(state).blocks
        fence -> [code(fence, true) | state.blocks]
      end

    Enum.reverse(blocks)
  end

  defp line(line, %{fence: %{} = fence} = state) do
    case Regex.run(@close, line, capture: :all_but_first) do
      [close]
      when binary_part(close, 0, 1) == binary_part(fence.marker, 0, 1) and
             byte_size(close) >= byte_size(fence.marker) ->
        fence = %{fence | source: [line | fence.source]}
        %{state | blocks: [code(fence, false) | state.blocks], fence: nil}

      _ ->
        %{state | fence: %{fence | source: [line | fence.source], body: [line | fence.body]}}
    end
  end

  defp line(line, state) do
    case Regex.run(@open, line, capture: :all_but_first) do
      [marker, language] ->
        fence = %{marker: marker, language: String.trim(language), source: [line], body: []}
        %{flush(state) | fence: fence}

      _ ->
        %{state | text: [line | state.text || []]}
    end
  end

  defp code(fence, open) do
    %{
      type: :code,
      language: fence.language,
      body: join(fence.body),
      source_text: join(fence.source),
      open: open
    }
  end

  defp flush(%{text: nil} = state), do: state

  defp flush(state) do
    case join(state.text) do
      "" -> %{state | text: nil}
      text -> %{state | blocks: [%{type: :text, text: text} | state.blocks], text: nil}
    end
  end

  defp join(lines), do: lines |> Enum.reverse() |> Enum.join("\n")
end
