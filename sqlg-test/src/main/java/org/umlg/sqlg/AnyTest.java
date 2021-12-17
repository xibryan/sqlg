package org.umlg.sqlg;

import org.junit.runner.RunWith;
import org.junit.runners.Suite;
import org.umlg.sqlg.test.topology.TestTopologyVertexLabelRename;

/**
 * Date: 2014/07/16
 * Time: 12:10 PM
 */
@RunWith(Suite.class)
@Suite.SuiteClasses({
//        TestTopologyEdgeLabelRename.class,
//        TestTopologyDeleteEdgeRole.class,
//        TestTopologyVertexLabelRenameDistributed.class,
        TestTopologyVertexLabelRename.class,
//        TestTopologyPropertyColumnRename.class,
//        TestTopologyPropertyColumnRenameDistributed.class,
//        TestReadOnlyRole.class,
//        TestLoadSchemaViaNotify.class,
//        TestPartitionMultipleGraphs.class,
//        TestTopologyChangeListener.class,
//        TestTopologyDelete.class,
//        TestTopologySchemaDeleteMultipleGraphs.class
})
public class AnyTest {
}
