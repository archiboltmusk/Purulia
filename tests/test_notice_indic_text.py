"""Tests for tools/notice-indic-text.py. Run: python3 tests/test_notice_indic_text.py

The LGD codes in the catalog below are fixture values (T-...), not real LGD codes.
"""
import importlib.util, json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "notice-indic-text.py"
spec = importlib.util.spec_from_file_location("notice_indic_text", SCRIPT)
nit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nit)

BN_SAMPLE = """
বিজ্ঞপ্তি নং: ৭৮/২০২৬
স্থান: পুরুলিয়া পৌরসভা, ওয়ার্ড নং ০৫ এবং ৩ নং ওয়ার্ড।
কাশীপুর উন্নয়ন ব্লকের অন্তর্গত সমস্ত পঞ্চায়েত এলাকায় পানীয় জল প্রকল্প।
"""
HI_SAMPLE = "नगर पालिका वार्ड नं ७ और वार्ड 8 में जल आपूर्ति।"
CATALOG = {
    "কাশীপুর": [{"lgd_code": "T-BLK-1", "level": "block"}],
    "পুরুলিয়া": [{"lgd_code": "T-ULB-1", "level": "ulb"}],
    "पुरुलिया": [{"lgd_code": "T-ULB-1", "level": "ulb"}],
}


class CleanText(unittest.TestCase):
    def test_nfc_composes_decomposed_matra(self):
        decomposed = "ো"  # e + aa, to be composed into o-sign
        self.assertEqual(nit.clean_text("প" + decomposed), "পো")

    def test_zero_width_removed(self):
        self.assertEqual(nit.clean_text("পৌর​সভা"), "পৌরসভা")

    def test_bengali_and_devanagari_digits(self):
        self.assertEqual(nit.clean_text("০৫ ३"), "05 3")

    def test_danda_breaks_line(self):
        self.assertEqual(nit.clean_text("প্রথম বাক্য।দ্বিতীয়"), "প্রথম বাক্য.\nদ্বিতীয়")

    def test_hasant_gap_fused(self):
        self.assertEqual(nit.clean_text("ক্ ষ"), "ক্ষ")

    def test_line_breaks_survive_whitespace_collapse(self):
        self.assertEqual(nit.clean_text("এক\n\n  দুই   তিন"), "এক\nদুই তিন")


class Wards(unittest.TestCase):
    def test_bengali_sample(self):
        self.assertEqual(nit.ward_numbers(nit.clean_text(BN_SAMPLE)), [3, 5])

    def test_hindi_sample(self):
        self.assertEqual(nit.ward_numbers(nit.clean_text(HI_SAMPLE)), [7, 8])

    def test_english_forms(self):
        text = "Ward IV and ward no. 09, also W-12 and Ward 04."
        self.assertEqual(nit.ward_numbers(nit.clean_text(text)), [4, 9, 12])

    def test_word_containing_w_is_not_a_ward(self):
        self.assertEqual(nit.ward_numbers(nit.clean_text("window 12 and water 3")), [])


class AdminUnits(unittest.TestCase):
    def test_bengali_sample_matches_block_and_ulb(self):
        units = nit.admin_units(nit.clean_text(BN_SAMPLE), CATALOG)
        self.assertEqual({u["lgd_code"] for u in units}, {"T-BLK-1", "T-ULB-1"})

    def test_name_without_admin_keyword_is_ignored(self):
        self.assertEqual(nit.admin_units(nit.clean_text("কাশীপুর মেলা"), CATALOG), [])

    def test_ocr_error_still_matches(self):
        # one dropped dirgha in the OCR output
        units = nit.admin_units(nit.clean_text("কাশিপুর উন্নয়ন ব্লক"), CATALOG)
        self.assertEqual([u["lgd_code"] for u in units], ["T-BLK-1"])

    def test_hindi_block(self):
        units = nit.admin_units(nit.clean_text("पुरुलिया नगर पालिका की सूचना"), CATALOG)
        self.assertEqual([u["lgd_code"] for u in units], ["T-ULB-1"])


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_end_to_end_with_lgd_csv(self):
        lgd = self.tmp / "lgd.csv"
        lgd.write_text("lgd_code,name,level,name_local\n"
                       "T-BLK-1,Kashipur,block,কাশীপুর\n"
                       "T-ULB-1,Purulia,ulb,পুরুলিয়া\n", encoding="utf-8")
        src = self.tmp / "notice.json"
        src.write_text(json.dumps({"file": "notice.pdf", "text": BN_SAMPLE, "needs_review": True}, ensure_ascii=False),
                       encoding="utf-8")
        proc = subprocess.run([sys.executable, str(SCRIPT), str(src), "--lgd", str(lgd)],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        [result] = json.loads(proc.stdout)
        self.assertEqual(result["wards"], [3, 5])
        self.assertEqual({u["lgd_code"] for u in result["admin_units"]}, {"T-BLK-1", "T-ULB-1"})
        self.assertTrue(result["needs_review"])
        self.assertEqual(result["file"], "notice.pdf")


if __name__ == "__main__":
    unittest.main()
