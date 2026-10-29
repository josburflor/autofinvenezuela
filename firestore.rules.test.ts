import fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-autofin-venezuela-security';

function makeValidLeadPayload(leadId: string, overrides: Record<string, unknown> = {}) {
  return {
    numericId: 1001,
    docId: leadId,
    firstName: 'Carlos',
    lastName: 'Mendoza',
    cedula: 'V-19482110',
    phone: '04143218890',
    email: 'cmendoza@correo.ve',
    city: 'Valencia',
    availableAmount: 3800,
    interestType: 'vehiculo',
    status: 'Nuevo',
    source: 'Formulario Web',
    nextCallAtIso: '2026-10-29T15:00:00.000Z',
    assignedAdvisorUid: '',
    vehicleCondition: 'Nuevo',
    vehicleYear: 2026,
    vehicleBrand: 'Livan',
    vehicleModel: 'X3 Pro',
    estimatedTotalAmount: 25080,
    selectedPlan: '',
    propertySeenConfirmed: false,
    propertyCategory: '',
    locationNotes: '',
    cedulaLockId: 'ced_V19482110',
    phoneLockId: 'tel_584143218890',
    emailLockId: 'eml_cmendoza_at_correo_ve',
    createdAtIso: '2026-10-29T12:00:00.000Z',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

export async function runDirtyDozenSecuritySuite() {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, 'admins', 'advisor_1'), {
        uid: 'advisor_1',
        email: 'asesor1@autofinvenezuela.com',
        displayName: 'Asesor Uno',
        role: 'asesor',
        isActive: true,
        createdByUid: 'owner_root',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await setDoc(doc(adminDb, 'leads', 'lead_existing'), {
        ...makeValidLeadPayload('lead_existing', {
          cedulaLockId: 'ced_V11111111',
          phoneLockId: 'tel_584121111111',
          emailLockId: 'eml_existing_at_correo_ve',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }),
      });
      await setDoc(doc(adminDb, 'leadLocks', 'ced_V11111111'), {
        lockId: 'ced_V11111111',
        lockType: 'cedula',
        leadDocId: 'lead_existing',
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(adminDb, 'leads', 'lead_closed'), {
        ...makeValidLeadPayload('lead_closed', {
          status: 'Cerrado',
          assignedAdvisorUid: 'advisor_1',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }),
      });
    });

    // 1. Dirty Dozen #1: Self-assigned super_admin by non-admin user
    const attackerCtx = testEnv.authenticatedContext('attacker_uid', {
      email: 'attacker@example.com',
      email_verified: true,
    });
    await assertFails(
      setDoc(doc(attackerCtx.firestore(), 'admins', 'attacker_uid'), {
        uid: 'attacker_uid',
        email: 'attacker@example.com',
        displayName: 'Attacker',
        role: 'super_admin',
        isActive: true,
        createdByUid: 'attacker_uid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Dirty Dozen #2: Unverified bootstrapped admin email spoofing
    const spoofAdminCtx = testEnv.authenticatedContext('spoof_uid', {
      email: 'josburflor@gmail.com',
      email_verified: false,
    });
    await assertFails(getDoc(doc(spoofAdminCtx.firestore(), 'leads', 'lead_existing')));

    // 3. Dirty Dozen #3: PII scraping by random verified user
    await assertFails(getDoc(doc(attackerCtx.firestore(), 'leads', 'lead_existing')));

    // 4. Dirty Dozen #4: Shadow field injection on Lead creation
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const shadowBatch = writeBatch(anonDb);
    shadowBatch.set(
      doc(anonDb, 'leads', 'lead_shadow'),
      makeValidLeadPayload('lead_shadow', { isApprovedVIP: true })
    );
    shadowBatch.set(doc(anonDb, 'leadLocks', 'ced_V19482110'), {
      lockId: 'ced_V19482110',
      lockType: 'cedula',
      leadDocId: 'lead_shadow',
      createdAt: serverTimestamp(),
    });
    shadowBatch.set(doc(anonDb, 'leadLocks', 'tel_584143218890'), {
      lockId: 'tel_584143218890',
      lockType: 'phone',
      leadDocId: 'lead_shadow',
      createdAt: serverTimestamp(),
    });
    shadowBatch.set(doc(anonDb, 'leadLocks', 'eml_cmendoza_at_correo_ve'), {
      lockId: 'eml_cmendoza_at_correo_ve',
      lockType: 'email',
      leadDocId: 'lead_shadow',
      createdAt: serverTimestamp(),
    });
    await assertFails(shadowBatch.commit());

    // 5. Dirty Dozen #5: Lead creation without atomic uniqueness locks
    await assertFails(
      setDoc(doc(anonDb, 'leads', 'lead_nolock'), makeValidLeadPayload('lead_nolock'))
    );

    // 6. Dirty Dozen #6: Duplicate cedula registration overwriting existing lock
    const dupBatch = writeBatch(anonDb);
    dupBatch.set(
      doc(anonDb, 'leads', 'lead_dup'),
      makeValidLeadPayload('lead_dup', { cedulaLockId: 'ced_V11111111' })
    );
    dupBatch.set(doc(anonDb, 'leadLocks', 'ced_V11111111'), {
      lockId: 'ced_V11111111',
      lockType: 'cedula',
      leadDocId: 'lead_dup',
      createdAt: serverTimestamp(),
    });
    dupBatch.set(doc(anonDb, 'leadLocks', 'tel_584149999999'), {
      lockId: 'tel_584149999999',
      lockType: 'phone',
      leadDocId: 'lead_dup',
      createdAt: serverTimestamp(),
    });
    dupBatch.set(doc(anonDb, 'leadLocks', 'eml_dup_at_correo_ve'), {
      lockId: 'eml_dup_at_correo_ve',
      lockType: 'email',
      leadDocId: 'lead_dup',
      createdAt: serverTimestamp(),
    });
    await assertFails(dupBatch.commit());

    // 7. Dirty Dozen #7: Public lead status spoofing ('Cerrado' on initial create)
    const statusSpoofBatch = writeBatch(anonDb);
    statusSpoofBatch.set(
      doc(anonDb, 'leads', 'lead_spoof_status'),
      makeValidLeadPayload('lead_spoof_status', { status: 'Cerrado' })
    );
    statusSpoofBatch.set(doc(anonDb, 'leadLocks', 'ced_V29999999'), {
      lockId: 'ced_V29999999',
      lockType: 'cedula',
      leadDocId: 'lead_spoof_status',
      createdAt: serverTimestamp(),
    });
    statusSpoofBatch.set(doc(anonDb, 'leadLocks', 'tel_584148888888'), {
      lockId: 'tel_584148888888',
      lockType: 'phone',
      leadDocId: 'lead_spoof_status',
      createdAt: serverTimestamp(),
    });
    statusSpoofBatch.set(doc(anonDb, 'leadLocks', 'eml_spoof_at_correo_ve'), {
      lockId: 'eml_spoof_at_correo_ve',
      lockType: 'email',
      leadDocId: 'lead_spoof_status',
      createdAt: serverTimestamp(),
    });
    await assertFails(statusSpoofBatch.commit());

    // 8. Dirty Dozen #8: Client timestamp forgery (past timestamp instead of request.time)
    const forgedTimeBatch = writeBatch(anonDb);
    forgedTimeBatch.set(
      doc(anonDb, 'leads', 'lead_forged_time'),
      makeValidLeadPayload('lead_forged_time', {
        createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      })
    );
    await assertFails(forgedTimeBatch.commit());

    // 9. Dirty Dozen #9: Terminal state bypass by non-admin advisor on 'Cerrado' lead
    const advisorCtx = testEnv.authenticatedContext('advisor_1', {
      email: 'asesor1@autofinvenezuela.com',
      email_verified: true,
    });
    await assertFails(
      updateDoc(doc(advisorCtx.firestore(), 'leads', 'lead_closed'), {
        status: 'Contactado',
        updatedAt: serverTimestamp(),
      })
    );

    // 10. Dirty Dozen #10: Value poisoning / oversized string on AdvisorProfile
    await assertFails(
      setDoc(doc(advisorCtx.firestore(), 'advisorProfiles', 'main'), {
        advisorName: 'A'.repeat(500),
        advisorTitle: 'Asesor Comercial',
        photoUrl: '/assets/photo.jpg',
        welcomeBio: 'Bio válida',
        officeAddress: 'CC Salvamall, Valencia, Carabobo, Venezuela',
        heroTitle: 'Título válido',
        heroSubtitle: 'Subtítulo válido',
        updatedByUid: 'advisor_1',
        updatedAt: serverTimestamp(),
      })
    );

    // 11. Dirty Dozen #11: Orphaned subcollection activity write under nonexistent lead
    await assertFails(
      setDoc(doc(advisorCtx.firestore(), 'leads', 'missing_lead', 'activities', 'act_1'), {
        numericId: 1,
        leadDocId: 'missing_lead',
        advisorUid: 'advisor_1',
        advisorName: 'Asesor Uno',
        activityType: 'llamada',
        title: 'Llamada inicial',
        description: 'Intento huérfano',
        scheduledAtIso: '',
        reminderEnabled: false,
        completed: true,
        createdAtIso: '2026-10-29T12:00:00.000Z',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 12. Dirty Dozen #12: Identity spoofing on activity creation (advisorUid != request.auth.uid)
    await assertFails(
      setDoc(doc(advisorCtx.firestore(), 'leads', 'lead_existing', 'activities', 'act_spoof'), {
        numericId: 2,
        leadDocId: 'lead_existing',
        advisorUid: 'someone_else',
        advisorName: 'Asesor Uno',
        activityType: 'nota',
        title: 'Nota suplantada',
        description: 'Intento de suplantar UID',
        scheduledAtIso: '',
        reminderEnabled: false,
        completed: true,
        createdAtIso: '2026-10-29T12:00:00.000Z',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Positive verification: Valid atomic web lead creation succeeds
    const validBatch = writeBatch(anonDb);
    validBatch.set(doc(anonDb, 'leads', 'lead_valid_1'), makeValidLeadPayload('lead_valid_1'));
    validBatch.set(doc(anonDb, 'leadLocks', 'ced_V19482110'), {
      lockId: 'ced_V19482110',
      lockType: 'cedula',
      leadDocId: 'lead_valid_1',
      createdAt: serverTimestamp(),
    });
    validBatch.set(doc(anonDb, 'leadLocks', 'tel_584143218890'), {
      lockId: 'tel_584143218890',
      lockType: 'phone',
      leadDocId: 'lead_valid_1',
      createdAt: serverTimestamp(),
    });
    validBatch.set(doc(anonDb, 'leadLocks', 'eml_cmendoza_at_correo_ve'), {
      lockId: 'eml_cmendoza_at_correo_ve',
      lockType: 'email',
      leadDocId: 'lead_valid_1',
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(validBatch.commit());
  } finally {
    await testEnv.cleanup();
  }
}
