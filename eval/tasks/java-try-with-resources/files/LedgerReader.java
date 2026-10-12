import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class LedgerReader {
    public List<String> lines(String path) throws IOException {
        List<String> out = new ArrayList<>();
        BufferedReader reader = new BufferedReader(new FileReader(path));
        try {
            String line;
            while ((line = reader.readLine()) != null) {
                out.add(line.strip());
            }
        } finally {
            reader.close();
        }
        return out;
    }
}
