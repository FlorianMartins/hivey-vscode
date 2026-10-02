import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class LedgerReader {
    /**
     * try-with-resources closes in the reverse order of opening, on every path, and a failure to
     * close is attached to the original exception instead of replacing it — which is what a
     * `finally` that throws does, hiding the error that mattered.
     */
    public List<String> lines(String path) throws IOException {
        List<String> out = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(path))) {
            String line;
            while ((line = reader.readLine()) != null) {
                out.add(line.strip());
            }
        }
        return out;
    }
}
