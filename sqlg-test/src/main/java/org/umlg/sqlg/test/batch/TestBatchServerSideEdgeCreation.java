package org.umlg.sqlg.test.batch;

import org.apache.commons.lang3.time.StopWatch;
import org.apache.commons.lang3.tuple.Pair;
import org.apache.tinkerpop.gremlin.process.traversal.dsl.graph.GraphTraversal;
import org.apache.tinkerpop.gremlin.structure.T;
import org.apache.tinkerpop.gremlin.structure.Vertex;
import org.junit.Assert;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.umlg.sqlg.structure.SchemaTable;
import org.umlg.sqlg.structure.SqlgVertex;
import org.umlg.sqlg.test.BaseTest;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public class TestBatchServerSideEdgeCreation extends BaseTest {

    @Before
    public void beforeTest() {
        Assume.assumeTrue(this.sqlgGraph.getSqlDialect().supportsBatchMode());
    }

    @Test
    public void testBulkEdges() {
        this.sqlgGraph.tx().batchModeOn();
        int count = 0;
        List<Pair<String, String>> uids = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            this.sqlgGraph.addVertex(T.label, "A", "index", Integer.toString(i));
            for (int j = 0; j < 10; j++) {
                this.sqlgGraph.addVertex(T.label, "B", "index", Integer.toString(count));
                uids.add(Pair.of(Integer.toString(i), Integer.toString(count++)));
            }
        }
        this.sqlgGraph.tx().commit();
        this.sqlgGraph.tx().streamingMode();
        SchemaTable a = SchemaTable.of(this.sqlgGraph.getSqlDialect().getPublicSchema(), "A");
        SchemaTable b = SchemaTable.of(this.sqlgGraph.getSqlDialect().getPublicSchema(), "B");
        SchemaTable ab = SchemaTable.of(this.sqlgGraph.getSqlDialect().getPublicSchema(), "AB");
        this.sqlgGraph.bulkAddEdges(a, b, ab, Pair.of("index", "index"), uids);
        this.sqlgGraph.tx().commit();

        Assert.assertEquals(10, this.sqlgGraph.traversal().V().hasLabel("A").count().next(), 0);
        Assert.assertEquals(100, this.sqlgGraph.traversal().V().hasLabel("B").count().next(), 0);
        Assert.assertEquals(100, this.sqlgGraph.traversal().V().hasLabel("A").out().count().next(), 0);
    }

    @Test
    public void testBulkEdges2() {
        StopWatch stopWatch = new StopWatch();
        stopWatch.start();
        this.sqlgGraph.tx().streamingMode();
        List<Pair<String, String>> uids = new ArrayList<>();
        LinkedHashMap properties = new LinkedHashMap();
        String uuid1Cache = null;
        String uuid2Cache = null;
        for (int i = 0; i < 1000; i++) {
            String uuid1 = UUID.randomUUID().toString();
            String uuid2 = UUID.randomUUID().toString();
            if (i == 50) {
                uuid1Cache = uuid1;
                uuid2Cache = uuid2;
            }
            uids.add(Pair.of(uuid1, uuid2));
            properties.put("id", uuid1);
            this.sqlgGraph.streamVertex("Person", properties);
            properties.put("id", uuid2);
            this.sqlgGraph.streamVertex("Person", properties);
        }
        this.sqlgGraph.tx().flush();
        this.sqlgGraph.tx().commit();
        stopWatch.stop();
        System.out.println(stopWatch.toString());
        stopWatch.reset();
        stopWatch.start();

        this.sqlgGraph.tx().streamingMode();
        SchemaTable person = SchemaTable.of(this.sqlgGraph.getSqlDialect().getPublicSchema(), "Person");
        this.sqlgGraph.bulkAddEdges(person, person, SchemaTable.of(this.sqlgGraph.getSqlDialect().getPublicSchema(), "friend"), Pair.of("id", "id"), uids);
        this.sqlgGraph.tx().commit();
        stopWatch.stop();
        System.out.println(stopWatch.toString());

        GraphTraversal<Vertex, Vertex> has = this.sqlgGraph.traversal().V().hasLabel("Person").has("id", uuid1Cache);
        Assert.assertTrue(has.hasNext());
        Vertex person50 = has.next();

        GraphTraversal<Vertex, Vertex> has1 = this.sqlgGraph.traversal().V().hasLabel("Person").has("id", uuid2Cache);
        Assert.assertTrue(has1.hasNext());
        Vertex person250 = has1.next();
        Assert.assertTrue(this.sqlgGraph.traversal().V(person50.id()).out().hasNext());
        Vertex person250Please = this.sqlgGraph.traversal().V(person50.id()).out().next();
        Assert.assertEquals(person250, person250Please);
    }

    @Test
    public void testStreamingWithBatchSize() {
        final int BATCH_SIZE = 1000;
        StopWatch stopWatch = new StopWatch();
        stopWatch.start();
        LinkedHashMap properties = new LinkedHashMap();
        this.sqlgGraph.tx().streamingBatchMode(BATCH_SIZE);
        List<Pair<SqlgVertex, SqlgVertex>> uids = new ArrayList<>();
        String uuidCache1 = null;
        String uuidCache2 = null;
        for (int i = 1; i <= 1000; i++) {
            String uuid1 = UUID.randomUUID().toString();
            String uuid2 = UUID.randomUUID().toString();
            if (i == 50) {
                uuidCache1 = uuid1;
                uuidCache2 = uuid2;
            }
            properties.put("id", uuid1);
            SqlgVertex v1 = this.sqlgGraph.streamVertexFixedBatch("Person", properties);
            properties.put("id", uuid2);
            SqlgVertex v2 = this.sqlgGraph.streamVertexFixedBatch("Person", properties);
            uids.add(Pair.of(v1, v2));
            if (i % (BATCH_SIZE / 2) == 0) {
                for (Pair<SqlgVertex, SqlgVertex> uid : uids) {
                    uid.getLeft().streamFixedBatchEdge("friend", uid.getRight());
                }
                //This is needed because the number of edges are less than the batch size so it will not be auto flushed
                this.sqlgGraph.tx().flush();
                uids.clear();
                this.sqlgGraph.tx().streamingBatchMode(BATCH_SIZE);
            }
        }
        this.sqlgGraph.tx().commit();
        stopWatch.stop();
        System.out.println(stopWatch.toString());
        stopWatch.reset();
        stopWatch.start();

        Assert.assertEquals(2000, this.sqlgGraph.traversal().V().hasLabel("Person").count().next(), 0);
        Assert.assertEquals(1000, this.sqlgGraph.traversal().E().hasLabel("friend").count().next(), 0);

        GraphTraversal<Vertex, Vertex> has = this.sqlgGraph.traversal().V().hasLabel("Person").has("id", uuidCache1);
        Assert.assertTrue(has.hasNext());
        Vertex person50 = has.next();

        GraphTraversal<Vertex, Vertex> has1 = this.sqlgGraph.traversal().V().hasLabel("Person").has("id", uuidCache2);
        Assert.assertTrue(has1.hasNext());
        Vertex person250 = has1.next();
        Assert.assertTrue(this.sqlgGraph.traversal().V(person50.id()).out().hasNext());
        Vertex person250Please = this.sqlgGraph.traversal().V(person50.id()).out().next();
        Assert.assertEquals(person250, person250Please);
    }

    @Test
    public void testStreamingWithBatchSizeWithCallBack() {
        final int BATCH_SIZE = 500;
        StopWatch stopWatch = new StopWatch();
        stopWatch.start();
        LinkedHashMap properties = new LinkedHashMap();
        final List<SqlgVertex> persons = new ArrayList<>();
        this.sqlgGraph.tx().streamingBatchMode(BATCH_SIZE, (e) -> {
            if (e instanceof SqlgVertex) {
                persons.add((SqlgVertex) e);
                SqlgVertex previous = null;
                for (SqlgVertex person : persons) {
                    if (previous == null) {
                        previous = person;
                    } else {
                        previous.streamFixedBatchEdge("friend", person);
                    }
                }
                this.sqlgGraph.tx().flush();
                persons.clear();
            }
        });
        for (int i = 1; i <= 1000; i++) {
            String uuid1 = UUID.randomUUID().toString();
            properties.put("id", uuid1);
            persons.add(this.sqlgGraph.streamVertexFixedBatch("Person", properties));
        }
        this.sqlgGraph.tx().commit();
        stopWatch.stop();
        System.out.println(stopWatch.toString());
        stopWatch.reset();
        stopWatch.start();

        Assert.assertEquals(1000, this.sqlgGraph.traversal().V().hasLabel("Person").count().next(), 0);
        Assert.assertEquals(999, this.sqlgGraph.traversal().E().hasLabel("friend").count().next(), 0);
    }

    @Test
    public void streamJava8Style() {
        List<String> uids = Arrays.asList("1", "2", "3", "4", "5");
        this.sqlgGraph.tx().streamingMode();
        uids.stream().forEach(u->this.sqlgGraph.streamVertex(T.label, "Person", "name", u));
        this.sqlgGraph.tx().commit();
        Assert.assertEquals(5, this.sqlgGraph.traversal().V().hasLabel("Person").count().next(), 0l);
    }

    @Test
    public void streamBatchJava8Style() {
        List<String> uids = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            uids.add(String.valueOf(i));
        }
        AtomicInteger count = new AtomicInteger(0);
        this.sqlgGraph.tx().streamingBatchMode(10, (v) -> {
            count.incrementAndGet();
        });
        uids.stream().forEach(u -> this.sqlgGraph.streamVertexFixedBatch(T.label, "Person", "name", u));
        this.sqlgGraph.tx().commit();
        Assert.assertEquals(100, this.sqlgGraph.traversal().V().hasLabel("Person").count().next(), 0l);
        Assert.assertEquals(10, count.get());
    }

    @Test
    public void testBatchContinuations() {
        this.sqlgGraph.tx().batchModeOn();
        Vertex v1 = this.sqlgGraph.addVertex(T.label, "Person");
        Vertex v2 = this.sqlgGraph.addVertex(T.label, "Dog");
        v1.addEdge("pet", v2);
        this.sqlgGraph.tx().flush();
        this.sqlgGraph.tx().streamingBatchMode(10);
        for (int i = 1; i <= 100; i++) {
            SqlgVertex v = this.sqlgGraph.streamVertexFixedBatch("Person", new LinkedHashMap<>());
        }
        this.sqlgGraph.tx().flush();
        this.sqlgGraph.tx().streamingMode();
        this.sqlgGraph.streamVertex("Person", new LinkedHashMap<>());
        this.sqlgGraph.tx().commit();
        Assert.assertEquals(102, this.sqlgGraph.traversal().V().hasLabel("Person").count().next(), 0l);
        Assert.assertEquals(1, this.sqlgGraph.traversal().V().hasLabel("Dog").count().next(), 0l);
    }

}
