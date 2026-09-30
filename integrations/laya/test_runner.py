import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("run-local-test.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

def sample():
    return {"routing": {"model": "multilingual"}, "answers": {"intent": {
        "type": "choice", "choice": "general", "answer_confidence": .8,
        "probabilities": {"general": .8, "coding": .05, "files": .05, "research": .05, "unclear": .05}}}}

class RunnerTests(unittest.TestCase):
    def test_rejects_bad_schema_and_nonfinite_values(self):
        self.assertEqual(runner.category_from(sample()), "general")
        for field, value in [("choice", "shell"), ("answer_confidence", float("nan")), ("answer_confidence", 1.1), ("low_confidence", True)]:
            data = sample(); data["answers"]["intent"][field] = value
            with self.assertRaises(ValueError): runner.category_from(data)
        data = sample(); data["routing"]["model"] = "english"
        with self.assertRaises(ValueError): runner.category_from(data)

    def test_missing_answers_are_not_reported_as_success(self):
        report = runner.summary([{"id": "x", "category": None, "correct": False, "seconds": 2}], 3)
        self.assertFalse(report["complete"]); self.assertIsNone(report["accuracy_on_answered"])
        self.assertEqual(report["answered"], 0); self.assertFalse(report["permission_granted"])

    def test_accuracy_counts_actual_labels_and_keeps_failures(self):
        rows = [{"id": "a", "category": "coding", "correct": True, "seconds": .1},
                {"id": "b", "category": "general", "correct": False, "seconds": .2},
                {"id": "c", "category": None, "correct": False, "seconds": 3}]
        report = runner.summary(rows, 10)
        self.assertEqual(report["accuracy_on_answered"], .5); self.assertFalse(report["complete"])
        self.assertEqual(len(report["results"]), 3)

if __name__ == "__main__": unittest.main()
