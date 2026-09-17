"""Self-tests for the differential comparator: it must reject wrong results, not only accept right ones.

    python3 tests/differential/test_compare.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import compare_rows, ordered_result  # noqa: E402

P = 'index=main sourcetype=spl2kql'


class RejectsWrongResults(unittest.TestCase):
    def assertFails(self, spl, s, c, opt=None):
        status, msg = compare_rows(spl, s, c, opt)
        self.assertNotEqual(status, 'PASS', f'comparator accepted a wrong result: {msg}')

    def test_reversed_order_of_a_sorted_result(self):
        rows = [{'n': '1'}, {'n': '2'}, {'n': '3'}]
        self.assertFails(f'{P} | sort 0 _time | table n', rows, list(reversed([{'n': 1}, {'n': 2}, {'n': 3}])))

    def test_wrong_value_in_a_field_absent_from_the_first_row(self):
        s = [{'host': 'a'}, {'host': 'b', 'user': 'bob'}]
        c = [{'host': 'a'}, {'host': 'b', 'user': 'eve'}]
        self.assertFails(f'{P} | table host, user', s, c)

    def test_field_only_cribl_has(self):
        self.assertFails(f'{P} | table host', [{'host': 'a'}], [{'host': 'a', 'user': 'bob'}])

    def test_one_zero_row_vs_two_zero_rows(self):
        self.assertFails(f'{P} nosuch=1 | stats count', [{'count': '0'}], [{'count': 0}, {'count': 0}])
        self.assertFails(f'{P} | stats count by host', [{'host': '', 'count': '0'}], [{'host': '', 'count': 0}, {'host': '', 'count': 0}])

    def test_zero_row_exception_needs_an_aggregate_without_by(self):
        self.assertFails(f'{P} | stats count by host', [{'host': '', 'count': '0'}], [])
        self.assertFails(f'{P} | table count', [{'count': '0'}], [])

    def test_row_count_mismatch(self):
        self.assertFails(f'{P} | stats count by host', [{'host': 'a', 'count': '1'}], [])

    def test_wrong_value_after_multiset_matching(self):
        self.assertFails(f'{P} | stats count by host', [{'host': 'a', 'count': '1'}, {'host': 'b', 'count': '2'}], [{'host': 'b', 'count': 1}, {'host': 'a', 'count': 2}])

    def test_ordered_override(self):
        self.assertFails(f'{P} | table n', [{'n': '1'}, {'n': '2'}], [{'n': 2}, {'n': 1}], {'ordered': True})


class AcceptsEquivalentResults(unittest.TestCase):
    def assertPasses(self, spl, s, c, opt=None):
        status, msg = compare_rows(spl, s, c, opt)
        self.assertEqual(status, 'PASS', msg)

    def test_unordered_result_in_any_order(self):
        self.assertPasses(f'{P} | stats count by host', [{'host': 'a', 'count': '1'}, {'host': 'b', 'count': '2'}], [{'host': 'b', 'count': 2}, {'host': 'a', 'count': 1}])

    def test_aggregate_without_by_over_no_events(self):
        self.assertPasses(f'{P} nosuch=1 | stats count', [{'count': '0'}], [])

    def test_data_model_prefixes(self):
        self.assertPasses('| tstats count from datamodel=Web.Web by Web.action', [{'Web.action': 'failure', 'count': '3'}], [{'action': 'failure', 'count': 3}])

    def test_sparse_fields_and_numeric_strings(self):
        self.assertPasses(f'{P} | table host, user', [{'host': 'a'}, {'host': 'b', 'user': 'bob'}], [{'host': 'a', 'user': None}, {'host': 'b', 'user': 'bob'}])

    def test_order_detection(self):
        self.assertTrue(ordered_result(f'{P} | stats count by host | sort -count | head 2'))
        self.assertTrue(ordered_result(f'{P} | sort 0 _time | tail 2'))
        self.assertTrue(ordered_result(f'{P} | top 3 uri'))
        self.assertFalse(ordered_result(f'{P} | sort 0 _time | streamstats count as n | stats max(n)'))
        self.assertFalse(ordered_result(f'{P} | stats count by host'))
        self.assertFalse(ordered_result(f'{P} | eval x="a|b" | stats count by x'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
